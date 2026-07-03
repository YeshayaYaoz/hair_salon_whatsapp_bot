import { Router } from "express";
import express from "express";
import crypto from "crypto";
import { resolveBusinessByPhoneNumberId } from "../tenants/resolve.js";
import { sendWhatsAppMessage, sendWhatsAppList, type ListRow } from "./whatsappClient.js";
import { handleIncomingMessage } from "../bot/claudeBot.js";
import { decryptSecret } from "../lib/crypto.js";
import { hasActiveSubscription } from "../lib/subscriptionGate.js";
import { rateLimit } from "../lib/rateLimit.js";

export const whatsappRouter = Router();

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

/** Extracts the customer's text from either a typed message or a tapped interactive list row. */
function extractMessageText(message: any): string | null {
  if (message.type === "text") return message.text.body as string;
  if (message.type === "interactive" && message.interactive?.type === "list_reply") {
    // The row id is the slot's ISO start time (see buildSlotRows); phrase it as a natural reply
    // so Claude's book_appointment tool call still has the exact ISO time to work with.
    return `I'll take the ${message.interactive.list_reply.title} slot (${message.interactive.list_reply.id})`;
  }
  return null;
}

function buildSlotRows(slots: { startTime: string }[]): ListRow[] {
  return slots.map((s) => {
    const d = new Date(s.startTime);
    return {
      id: s.startTime,
      title: d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).slice(0, 24),
    };
  });
}

whatsappRouter.post("/", webhookLimiter, rawBodyMiddleware, async (req, res) => {
  // Verify Meta's HMAC signature before processing.
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  if (!verifyMetaSignature(req.body as Buffer, signature)) {
    console.warn("WhatsApp webhook: invalid signature, rejecting request");
    return res.sendStatus(403);
  }

  // Parse body now that signature is verified (raw middleware gives us a Buffer).
  const payload = JSON.parse((req.body as Buffer).toString("utf8"));

  // Acknowledge immediately; Meta retries aggressively if it doesn't get a fast 200.
  res.sendStatus(200);

  let phoneNumberId: string | undefined;
  let accessToken: string | undefined;
  let customerPhone: string | undefined;

  try {
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    phoneNumberId = change?.metadata?.phone_number_id;
    const message = change?.messages?.[0];
    if (!phoneNumberId || !message) return;

    const text = extractMessageText(message);
    if (!text) return;

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

    const { text: reply, offeredSlots } = await handleIncomingMessage(business.id, customerPhone, text);

    if (offeredSlots && offeredSlots.length > 0) {
      await sendWhatsAppList({
        phoneNumberId,
        accessToken,
        to: customerPhone,
        bodyText: reply,
        buttonText: "Pick a time",
        rows: buildSlotRows(offeredSlots),
      });
    } else {
      await sendWhatsAppMessage({ phoneNumberId, accessToken, to: customerPhone, text: reply });
    }
  } catch (err) {
    console.error("Error handling WhatsApp webhook event:", err);
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
