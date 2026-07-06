import { Router } from "express";
import express from "express";
import crypto from "crypto";
import { resolveBusinessByPhoneNumberId } from "../tenants/resolve.js";
import { sendWhatsAppMessage, sendWhatsAppList, WhatsAppAuthError, type ListRow } from "./whatsappClient.js";
import { sendWhatsAppTokenExpiredEmail } from "../lib/email.js";
import { handleIncomingMessage } from "../bot/claudeBot.js";
import { clearHistory } from "../bot/conversationStore.js";
import { decryptSecret } from "../lib/crypto.js";
import { hasActiveSubscription } from "../lib/subscriptionGate.js";
import { rateLimit } from "../lib/rateLimit.js";
import { prisma } from "../lib/prisma.js";
import { captureError } from "../lib/errorMonitoring.js";

export const whatsappRouter = Router();

// Deduplicate Meta webhook deliveries — Meta guarantees at-least-once, so the same
// message can arrive twice within seconds. We keep message IDs for 5 minutes.
const processedMessageIds = new Map<string, number>();
const MESSAGE_TTL_MS = 5 * 60 * 1000;
function isDuplicate(messageId: string): boolean {
  const now = Date.now();
  // Evict stale entries periodically (on every call, cheap enough)
  for (const [id, ts] of processedMessageIds) {
    if (now - ts > MESSAGE_TTL_MS) processedMessageIds.delete(id);
  }
  if (processedMessageIds.has(messageId)) return true;
  processedMessageIds.set(messageId, now);
  return false;
}

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyPrefix: "wa",
});

// Meta calls this once to verify the webhook URL when you configure it in the Meta dashboard.
whatsappRouter.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

/** Verify Meta's X-Hub-Signature-256 header against the raw request body. */
function verifyMetaSignature(rawBody: Buffer, signature: string | undefined): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return true; // Skip verification if not configured (dev mode)
  if (!signature?.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

const rawBodyMiddleware = express.raw({ type: "application/json" });

type ExtractedMessage =
  | { kind: "text"; text: string }
  | { kind: "reset" }
  | { kind: "unsupported" }
  | { kind: "ignore" };

// Keywords that reset the conversation, in Hebrew and English.
const RESET_KEYWORDS = ["התחל מחדש", "אתחל", "איפוס", "restart", "start over", "reset"];

/** Classifies an incoming WhatsApp message into how the bot should react. */
function extractMessage(message: any): ExtractedMessage {
  if (message.type === "text") {
    const body = (message.text?.body as string ?? "").trim();
    if (RESET_KEYWORDS.some((k) => body.toLowerCase() === k.toLowerCase())) return { kind: "reset" };
    return { kind: "text", text: body };
  }
  if (message.type === "interactive" && message.interactive?.type === "list_reply") {
    // The row id is the slot's ISO start time (see buildSlotRows); phrase it as a natural reply
    // so Claude's book_appointment tool call still has the exact ISO time to work with.
    return { kind: "text", text: `אני רוצה את המועד ${message.interactive.list_reply.title} (${message.interactive.list_reply.id})` };
  }
  // Voice notes, images, stickers, documents, location, etc. — the bot can't read these.
  if (["audio", "voice", "image", "video", "sticker", "document", "location", "contacts"].includes(message.type)) {
    return { kind: "unsupported" };
  }
  return { kind: "ignore" };
}

/** Rough per-message language detection: any Hebrew character → Hebrew, otherwise English. */
function detectLang(text: string): "he" | "en" {
  return /[֐-׿]/.test(text) ? "he" : "en";
}

function buildSlotRows(slots: { startTime: string }[], lang: "he" | "en"): ListRow[] {
  const locale = lang === "he" ? "he-IL" : "en-US";
  return slots.map((s) => {
    const d = new Date(s.startTime);
    return {
      id: s.startTime,
      title: d.toLocaleString(locale, { timeZone: "Asia/Jerusalem", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).slice(0, 24),
    };
  });
}

whatsappRouter.post("/", webhookLimiter, rawBodyMiddleware, async (req, res) => {
  // Verify Meta's HMAC signature before processing.
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const rawBody: Buffer = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
  if (!verifyMetaSignature(rawBody, signature)) {
    console.warn("WhatsApp webhook: invalid signature, rejecting request");
    return res.sendStatus(403);
  }

  // Parse body now that signature is verified (raw middleware gives us a Buffer).
  const payload = JSON.parse(rawBody.toString("utf8"));

  // Acknowledge immediately; Meta retries aggressively if it doesn't get a fast 200.
  res.sendStatus(200);

  let phoneNumberId: string | undefined;
  let accessToken: string | undefined;
  let customerPhone: string | undefined;
  let businessRef: { id: string; name: string; email: string } | undefined;

  try {
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    phoneNumberId = change?.metadata?.phone_number_id;
    const message = change?.messages?.[0];
    if (!phoneNumberId || !message) return;

    if (message.id && isDuplicate(message.id as string)) {
      console.log(`WhatsApp webhook: duplicate message ${message.id as string}, skipping`);
      return;
    }

    const extracted = extractMessage(message);
    if (extracted.kind === "ignore") return;

    const business = await resolveBusinessByPhoneNumberId(phoneNumberId);
    if (!business?.whatsappAccessToken) {
      console.warn(`No business configured for phone_number_id ${phoneNumberId}`);
      return;
    }
    if (!(await hasActiveSubscription(business.id))) {
      console.warn(`Ignoring message for business ${business.id}: subscription not active`);
      return;
    }

    customerPhone = message.from as string;
    accessToken = decryptSecret(business.whatsappAccessToken);
    businessRef = { id: business.id, name: business.name, email: business.email };

    // Follow the customer's language for canned replies and interactive UI pieces.
    const lang: "he" | "en" = extracted.kind === "text" ? detectLang(extracted.text) : "he";

    if (extracted.kind === "reset") {
      await clearHistory(business.id, customerPhone);
      await sendWhatsAppMessage({ phoneNumberId, accessToken, to: customerPhone, text: "השיחה אופסה. איך אפשר לעזור? 😊" });
      return;
    }

    if (extracted.kind === "unsupported") {
      await sendWhatsAppMessage({
        phoneNumberId,
        accessToken,
        to: customerPhone,
        text: "מצטערים, אני יכול לקרוא רק הודעות טקסט. אנא כתבו לי מה תרצו ואשמח לעזור 😊\nSorry, I can only read text messages — please type what you need 😊",
      });
      return;
    }

    const { text: reply, offeredSlots } = await handleIncomingMessage(business.id, customerPhone, extracted.text);

    if (offeredSlots && offeredSlots.length > 0) {
      await sendWhatsAppList({
        phoneNumberId,
        accessToken,
        to: customerPhone,
        bodyText: reply,
        buttonText: lang === "he" ? "בחר מועד" : "Pick a time",
        sectionTitle: lang === "he" ? "מועדים פנויים" : "Available times",
        rows: buildSlotRows(offeredSlots, lang),
      });
    } else {
      await sendWhatsAppMessage({ phoneNumberId, accessToken, to: customerPhone, text: reply });
    }
  } catch (err) {
    // A bad/expired access token: alert the owner by email (we can't WhatsApp them — same token).
    if (err instanceof WhatsAppAuthError) {
      console.error("WhatsApp access token expired/invalid:", err.message);
      if (businessRef?.id) {
        // Reflect the broken connection in the dashboard.
        await prisma.business
          .update({ where: { id: businessRef.id }, data: { whatsappTokenValid: false } })
          .catch((dbErr) => console.error("Failed to flag WhatsApp token invalid:", dbErr));
      }
      if (businessRef?.email) {
        await sendWhatsAppTokenExpiredEmail(businessRef.email, businessRef.name).catch((mailErr) =>
          console.error("Failed to send token-expiry email:", mailErr)
        );
      }
      return;
    }

    console.error("Error handling WhatsApp webhook event:", err);
    captureError(err, { businessId: businessRef?.id, customerPhone });
    // Let the customer know something went wrong instead of leaving them hanging on silence.
    if (phoneNumberId && accessToken && customerPhone) {
      await sendWhatsAppMessage({
        phoneNumberId,
        accessToken,
        to: customerPhone,
        text: "מצטערים, אירעה שגיאה. אנא נסו שוב בעוד כמה דקות.",
      }).catch((sendErr) => console.error("Failed to send error fallback message:", sendErr));
    }
  }
});
