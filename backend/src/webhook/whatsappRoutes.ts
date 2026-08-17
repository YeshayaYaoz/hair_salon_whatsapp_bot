import { asyncRouter } from "../lib/asyncRouter.js";
import express from "express";
import crypto from "crypto";
import { resolveBusinessByPhoneNumberId } from "../tenants/resolve.js";
import { sendWhatsAppMessage, sendWhatsAppList, sendWhatsAppImage, sendWhatsAppCtaUrl, sendWhatsAppButtons, WhatsAppAuthError, type ListRow } from "./whatsappClient.js";
import { sendWhatsAppTokenExpiredEmail } from "../lib/email.js";
import { handleIncomingMessage } from "../bot/claudeBot.js";
import { checkDailyCap } from "../lib/dailyMessageCap.js";
import { notifyOwner } from "../lib/ownerNotify.js";
import { clearHistory, appendTurn } from "../bot/conversationStore.js";
import { decryptSecret } from "../lib/crypto.js";
import { hasActiveSubscription } from "../lib/subscriptionGate.js";
import { rateLimit } from "../lib/rateLimit.js";
import { prisma } from "../lib/prisma.js";
import { handleTemplateStatusUpdate } from "./templateStatus.js";
import { handleOutreachReply, isOutreachNumber } from "../leadfinder/inboundReplies.js";
import { Prisma } from "@prisma/client";
import { captureError } from "../lib/errorMonitoring.js";
import { transcribeWhatsAppVoiceNote, TranscriptionNotConfiguredError } from "../lib/transcription.js";
import { sendYieldCampaignOffers, type PendingYieldCampaign } from "../billing/yieldCampaignJob.js";
import { logWhatsAppBillingEvent } from "../lib/usageLedger.js";

export const whatsappRouter = asyncRouter();

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
  | { kind: "voiceNote"; mediaId: string }
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
  // A quick-reply tap. The title is exactly what the customer would have typed, so it enters the
  // conversation as an ordinary message and the bot needs no special case for it.
  if (message.type === "interactive" && message.interactive?.type === "button_reply") {
    return { kind: "text", text: (message.interactive.button_reply?.title as string ?? "").trim() };
  }
  if (message.type === "interactive" && message.interactive?.type === "list_reply") {
    // The row id is the slot's ISO start time (see buildSlotRows); phrase it as a natural reply
    // so Claude's book_appointment tool call still has the exact ISO time to work with.
    return { kind: "text", text: `אני רוצה את המועד ${message.interactive.list_reply.title} (${message.interactive.list_reply.id})` };
  }
  // WhatsApp's real message type for both voice notes (PTT) and regular audio files is "audio"
  // (message.audio.voice distinguishes the two, but we treat both as speech-to-transcribe).
  if (message.type === "audio" && message.audio?.id) {
    return { kind: "voiceNote", mediaId: message.audio.id as string };
  }
  // Images, videos, stickers, documents, location, etc. — the bot can't read these.
  if (["image", "video", "sticker", "document", "location", "contacts"].includes(message.type)) {
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

const AFFIRMATIVE = /^(כן|בטח|אישור|yes|y|ok|okay|sure)/i;
const NEGATIVE = /^(לא|no|n|skip|בטל)/i;

/** Handles the business owner's reply to a pending yield-management campaign proposal. */
async function handleYieldCampaignReply(
  business: { id: string; name: string; notificationPhone: string; whatsappPhoneNumberId: string; whatsappAccessToken: string; pendingYieldCampaign: unknown },
  phoneNumberId: string,
  accessToken: string,
  replyText: string
): Promise<void> {
  const trimmed = replyText.trim();
  const campaign = business.pendingYieldCampaign as PendingYieldCampaign;

  if (AFFIRMATIVE.test(trimmed)) {
    const sent = await sendYieldCampaignOffers(business, campaign);
    await prisma.business.update({ where: { id: business.id }, data: { pendingYieldCampaign: Prisma.JsonNull } });
    await sendWhatsAppMessage({ phoneNumberId, accessToken, to: business.notificationPhone, text: `נשלחה הצעה ל-${sent} לקוחות. בהצלחה! 🎉` });
    return;
  }

  if (NEGATIVE.test(trimmed)) {
    await prisma.business.update({ where: { id: business.id }, data: { pendingYieldCampaign: Prisma.JsonNull } });
    await sendWhatsAppMessage({ phoneNumberId, accessToken, to: business.notificationPhone, text: "בסדר גמור, לא שלחתי כלום 👍" });
    return;
  }

  await sendWhatsAppMessage({
    phoneNumberId, accessToken, to: business.notificationPhone,
    text: `יש לי הצעה ממתינה לאישור: לשלוח הנחה ל-${campaign.candidateCustomerIds.length} לקוחות למילוי מקומות פנויים מחר. יש לענות "כן" או "לא".`,
  });
}

/** Logs each status entry that carries a real Meta billing category/billable flag. Meta only
 * attaches `pricing` to status callbacks it actually bills for — most delivery/read receipts have
 * no pricing field at all and are skipped here, same as WhatsApp's own accounting would skip them. */
async function recordWhatsAppBillingStatuses(phoneNumberId: string, statuses: any[]) {
  // Delivery FAILURES arrive here too, and used to be filtered out with everything unpriced. That
  // made them perfectly invisible: the send API returns 200 with a message id (Meta "accepted" it),
  // and the real verdict — e.g. 131047, free-form message outside the 24h session window — lands
  // asynchronously in this callback. An owner alert died this way on a live call while the agent
  // told the caller "ההודעה נשלחה": every layer reported success because the only layer that knew
  // otherwise was being thrown away right here.
  for (const status of statuses) {
    if (status?.status === "failed") {
      const errors = (status.errors ?? []).map((e: any) => `${e.code} ${e.title ?? ""}`).join("; ") || "unknown";
      console.error(`[whatsapp webhook] Message ${status.id} to ${status.recipient_id} FAILED: ${errors}`);
      captureError(new Error(`WhatsApp delivery failed: ${errors}`), {
        kind: "whatsappDeliveryFailure", phoneNumberId, recipient: status.recipient_id,
      });
    }
  }

  const billed = statuses.filter((s) => s?.pricing);
  if (billed.length === 0) return;
  try {
    const business = await resolveBusinessByPhoneNumberId(phoneNumberId);
    if (!business) return;
    for (const status of billed) {
      await logWhatsAppBillingEvent({
        businessId: business.id,
        customerPhone: status.recipient_id as string,
        category: status.pricing?.category ?? "unknown",
        billable: Boolean(status.pricing?.billable),
      });
    }
  } catch (err) {
    console.error("[whatsapp webhook] Failed to record billing status:", err);
  }
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
    const field = entry?.changes?.[0]?.field as string | undefined;
    const change = entry?.changes?.[0]?.value;

    // Meta's answer to the templates we submit at connect. Arrives on its own field, with the WABA
    // id on the entry rather than in the value — there is no phone_number_id here, so this has to
    // be handled before the metadata lookup below discards the delivery as unrecognised.
    if (field === "message_template_status_update" && entry?.id) {
      await handleTemplateStatusUpdate(String(entry.id), change ?? {});
      return;
    }

    phoneNumberId = change?.metadata?.phone_number_id;

    // Delivery-status callbacks carry Meta's own real per-message billing category/billable flag
    // (statuses[].pricing) — this is the actual ledger entry, not a guess, so log it whenever
    // present. These arrive as separate webhook deliveries from the inbound message itself.
    if (phoneNumberId && Array.isArray(change?.statuses) && change.statuses.length > 0) {
      await recordWhatsAppBillingStatuses(phoneNumberId, change.statuses);
    }

    const message = change?.messages?.[0];
    if (!phoneNumberId || !message) return;

    if (message.id && isDuplicate(message.id as string)) {
      console.log(`WhatsApp webhook: duplicate message ${message.id as string}, skipping`);
      return;
    }

    const extracted = extractMessage(message);
    if (extracted.kind === "ignore") return;

    // Replies to Tori's own cold-outreach number, which no Business row owns — without this they
    // fall through to the "no business configured" warning below and are lost.
    if (isOutreachNumber(phoneNumberId)) {
      // Raw body rather than `extracted`, which classifies bot keywords a prospect never meant:
      // a lead whose reply happens to be a reset keyword would otherwise arrive as "(לא טקסט)".
      const replyText =
        (message.text?.body as string | undefined)?.trim() ||
        (extracted.kind === "text" ? extracted.text : "(הודעה שאינה טקסט)");
      await handleOutreachReply(message.from as string, replyText);
      return;
    }

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

    // Register anyone who writes in as a customer, before doing anything else with the message.
    //
    // Customer rows used to be created only by booking (availability.ts) and the waitlist, which
    // silently excluded every inquiry-mode business: a B&B never books through the bot, so its
    // Customers page stayed empty however many people had messaged, and the Conversations list
    // showed phone numbers with no names attached. The dashboard's own empty state promises that
    // "every customer who writes to the bot is saved here automatically" — this makes that true.
    //
    // Non-fatal: a failure here must not cost the customer their reply.
    await prisma.customer
      .upsert({
        where: { businessId_phone: { businessId: business.id, phone: customerPhone } },
        create: { businessId: business.id, phone: customerPhone },
        update: {},
      })
      .catch((err) => console.error("[webhook] Failed to register customer:", err));

    // The owner's own number replying to a pending yield-management campaign proposal
    // (see yieldCampaignJob.ts) is handled here, before any of this routes to the customer bot.
    if (business.pendingYieldCampaign && business.notificationPhone && customerPhone === business.notificationPhone && extracted.kind === "text") {
      await handleYieldCampaignReply(
        { ...business, notificationPhone: business.notificationPhone, whatsappPhoneNumberId: phoneNumberId, whatsappAccessToken: business.whatsappAccessToken },
        phoneNumberId,
        accessToken,
        extracted.text
      );
      return;
    }

    // If the owner has taken over this thread (sent a manual message from the dashboard), the
    // bot stays silent so it doesn't talk over a human mid-conversation — but the customer's
    // message is still persisted so it shows up in the transcript when the owner resumes the bot.
    // Business-wide kill switch: the owner turned the bot off entirely (holiday, emergency, or
    // they want to answer manually today). Still persist the message so nothing is lost from the
    // transcript when they switch it back on.
    if (!business.botEnabled) {
      const preview =
        extracted.kind === "text" ? extracted.text
        : extracted.kind === "voiceNote" ? "[הודעה קולית]"
        : extracted.kind === "reset" ? "[בקשת איפוס שיחה]"
        : "[הודעה]";
      await appendTurn(business.id, customerPhone, { role: "user", content: preview });
      console.log(`[bot] business ${business.id} has the bot disabled — staying silent`);
      return;
    }

    const pausedCustomer = await prisma.customer.findUnique({
      where: { businessId_phone: { businessId: business.id, phone: customerPhone } },
      select: { botPaused: true },
    });
    if (pausedCustomer?.botPaused) {
      const preview =
        extracted.kind === "text" ? extracted.text
        : extracted.kind === "voiceNote" ? "[הודעה קולית]"
        : extracted.kind === "reset" ? "[בקשת איפוס שיחה]"
        : "[הודעה]";
      await appendTurn(business.id, customerPhone, { role: "user", content: preview });
      return;
    }

    /**
     * Daily ceiling per customer.
     *
     * Checked here rather than inside the bot so a capped thread costs nothing: no prompt is built
     * and no model is called. The message is still persisted, so the owner sees the whole thread —
     * including whatever was being sent a hundred times — when they open the conversation.
     *
     * The customer is told once, at the moment they cross, and then the line goes quiet for them.
     * Saying it on every subsequent message would be its own send loop.
     */
    const cap = await checkDailyCap(business.id, customerPhone);
    if (cap.exceeded) {
      const preview = extracted.kind === "text" ? extracted.text : "[הודעה]";
      await appendTurn(business.id, customerPhone, { role: "user", content: preview });
      console.warn(`[bot] daily cap reached for ${customerPhone} at ${business.id} (${cap.count} messages) — staying silent`);

      if (cap.justCrossed) {
        const notice = detectLang(preview) === "he"
          ? "קיבלנו הרבה הודעות מהמספר הזה היום, אז אני עוצר כאן. אפשר להמשיך מאוחר יותר, או לפנות ישירות לבעל העסק."
          : "We've had a lot of messages from this number today, so I'll stop here. We can continue later, or you can contact the business directly.";
        await sendWhatsAppMessage({ phoneNumberId, accessToken, to: customerPhone, text: notice }).catch((err) => {
          console.error("[bot] failed to send the daily-cap notice:", err);
        });
        // Worth an owner alert: a thread hitting this is either a real customer in trouble or
        // something abusive, and both are things a person should look at.
        await notifyOwner(
          business.id,
          `⚠️ מספר ${customerPhone} שלח מעל ${cap.count} הודעות ב-24 השעות האחרונות. הבוט הפסיק לענות לו. כדאי להציץ בשיחה.`
        ).catch(() => {});
      }
      return;
    }

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

    // Resolve the actual message text to hand to the bot — either typed directly, or
    // transcribed from a voice note first.
    let textToProcess: string;
    if (extracted.kind === "voiceNote") {
      try {
        textToProcess = await transcribeWhatsAppVoiceNote(extracted.mediaId, accessToken);
        if (!textToProcess) throw new Error("Empty transcription result");
        console.log(`[bot] Transcribed voice note: "${textToProcess.slice(0, 80)}"`);
      } catch (err) {
        if (err instanceof TranscriptionNotConfiguredError) {
          await sendWhatsAppMessage({
            phoneNumberId,
            accessToken,
            to: customerPhone,
            text: "מצטערים, אני עדיין לא יכול להאזין להודעות קוליות. אפשר לכתוב לי בטקסט? 😊\nSorry, I can't listen to voice messages yet — could you type instead? 😊",
          });
          return;
        }
        console.error("Voice transcription failed:", err);
        captureError(err, { businessId: business.id, customerPhone, kind: "voiceTranscription" });
        await sendWhatsAppMessage({
          phoneNumberId,
          accessToken,
          to: customerPhone,
          text: "לא הצלחתי להבין את ההודעה הקולית. אפשר לנסות שוב או לכתוב בטקסט? 😊",
        });
        return;
      }
    } else {
      textToProcess = extracted.text;
    }

    // Follow the customer's language (detected from typed text or the voice transcript) for
    // canned replies and interactive UI pieces.
    const lang: "he" | "en" = detectLang(textToProcess);

    const { text: reply, offeredSlots, photos, isFirstReply, greetingText } = await handleIncomingMessage(business.id, customerPhone, textToProcess);

    // A greeting with a button turns the first thing a customer sees into something they can act
    // on, instead of a wall of text with a URL they have to notice, select and paste. Only on the
    // opening message: a button on every reply becomes furniture and stops being read.
    const greetingButton =
      isFirstReply && business.greetingButtonText && business.greetingButtonUrl
        ? { text: business.greetingButtonText, url: business.greetingButtonUrl }
        : null;
    const quickReplies = isFirstReply && business.quickReplies.length > 0 ? business.quickReplies : null;

    /**
     * One message by default: the welcome and the answer, separated by a blank line.
     *
     * Two messages for a single "שלום" reads as a bot talking to itself — the owner saw their own
     * line do it. Concatenating rather than letting the model weave the welcome in keeps the
     * original guarantee: folded into the reply by the model it was paraphrased, trimmed or dropped
     * outright the moment there was a real question in front of it, and someone opening with "how
     * much for the weekend?" never saw it. Joined here it still goes out exactly as written.
     *
     * Two cases still split, and neither can be argued away:
     *
     *   * A configured greeting button. WhatsApp allows one button type per message, so a link
     *     button and the quick replies cannot share one — merging would silently drop whichever
     *     lost. Across two messages each takes one.
     *   * A combined body past the interactive limit. sendWhatsAppButtons trims the body to 1024
     *     characters, and a long welcome plus a reply can cross that: merging would cut the owner's
     *     text mid-sentence with nothing to say it had happened.
     *
     * `greetingSeparateMessage` lets an owner choose the split anyway.
     */
    const INTERACTIVE_BODY_LIMIT = 1024;
    const willBeInteractive = Boolean((offeredSlots && offeredSlots.length > 0) || quickReplies);
    const mergedBody = greetingText ? `${greetingText}\n\n${reply}` : reply;
    const mergeGreeting =
      Boolean(greetingText) &&
      !business.greetingSeparateMessage &&
      !greetingButton &&
      (!willBeInteractive || mergedBody.length <= INTERACTIVE_BODY_LIMIT);

    // What every branch below sends. Identical to `reply` unless the welcome is riding along.
    const bodyText = mergeGreeting ? mergedBody : reply;

    if (greetingText && !mergeGreeting) {
      try {
        if (greetingButton) {
          await sendWhatsAppCtaUrl({
            phoneNumberId, accessToken, to: customerPhone,
            body: greetingText, buttonText: greetingButton.text, url: greetingButton.url,
          });
        } else {
          await sendWhatsAppMessage({ phoneNumberId, accessToken, to: customerPhone, text: greetingText });
        }
      } catch (greetErr) {
        // The answer below matters more than the welcome — losing the greeting is a worse first
        // impression, but losing the reply is a broken bot.
        console.error("[whatsapp] Greeting message failed, continuing with the reply:", greetErr);
        captureError(greetErr, { businessId: business.id, customerPhone, kind: "greetingMessage" });
      }
    }

    if (offeredSlots && offeredSlots.length > 0) {
      await sendWhatsAppList({
        phoneNumberId,
        accessToken,
        to: customerPhone,
        bodyText,
        buttonText: lang === "he" ? "בחר מועד" : "Pick a time",
        sectionTitle: lang === "he" ? "מועדים פנויים" : "Available times",
        rows: buildSlotRows(offeredSlots, lang),
      });
    } else if (quickReplies) {
      try {
        await sendWhatsAppButtons({ phoneNumberId, accessToken, to: customerPhone, body: bodyText, buttons: quickReplies });
      } catch (btnErr) {
        console.error("[whatsapp] Quick replies failed, sending plain text instead:", btnErr);
        captureError(btnErr, { businessId: business.id, customerPhone, kind: "quickReplies" });
        await sendWhatsAppMessage({ phoneNumberId, accessToken, to: customerPhone, text: bodyText });
      }
    } else if (greetingButton && !greetingText) {
      try {
        await sendWhatsAppCtaUrl({
          phoneNumberId,
          accessToken,
          to: customerPhone,
          body: bodyText,
          buttonText: greetingButton.text,
          url: greetingButton.url,
        });
      } catch (ctaErr) {
        // A malformed button URL, or a WABA that hasn't been approved for interactive messages,
        // must not cost the customer their first reply — fall back to plain text.
        console.error("[whatsapp] Greeting button failed, sending plain text instead:", ctaErr);
        captureError(ctaErr, { businessId: business.id, customerPhone, kind: "greetingButton" });
        await sendWhatsAppMessage({ phoneNumberId, accessToken, to: customerPhone, text: bodyText });
      }
    } else {
      await sendWhatsAppMessage({ phoneNumberId, accessToken, to: customerPhone, text: bodyText });
    }

    // Photos go out after the text so the customer reads the lead-in first. Sent one at a time
    // (WhatsApp has no multi-image message) and in order. A single bad URL — a link the owner
    // pasted wrong, or an image host that's down — must not swallow the rest or the whole reply,
    // which the customer has already received at this point.
    for (const photo of photos ?? []) {
      try {
        await sendWhatsAppImage({ phoneNumberId, accessToken, to: customerPhone, imageUrl: photo.url, caption: photo.caption });
      } catch (photoErr) {
        console.error("Failed to send photo:", photo.url, photoErr);
        captureError(photoErr, { businessId: business.id, customerPhone, kind: "sendPhoto" });
      }
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
