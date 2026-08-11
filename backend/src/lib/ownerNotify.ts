import { prisma } from "./prisma.js";
import { decryptSecret } from "./crypto.js";
import { normalizePhone } from "./phone.js";
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "../webhook/whatsappClient.js";

/**
 * Sends a WhatsApp message to the business owner's own notification number — used for new-booking
 * alerts, human-handoff requests, etc. Shared between the WhatsApp bot and the voice bot (Cartesia
 * tool calls) so both notify the owner the same way. Returns true only if the owner was actually
 * reachable and the send succeeded.
 *
 * "Succeeded" needs the 24h caveat spelled out, because it burned a live call. Meta's send API
 * returns 200 with a message id for a free-form message even when the recipient has no open
 * customer-service window — the rejection (131047) arrives asynchronously on the status webhook.
 * So an owner who hadn't messaged their own bot in 24 hours lost every alert while this function
 * returned true and the voice agent told the caller "ההודעה נשלחה".
 *
 * Hence the window check: the owner's window is open only if a message FROM their number reached
 * this business in the last ~24h (their inbound messages are in ConversationMessage like anyone
 * else's). Outside it, delivery needs a Meta-approved UTILITY template with one {{1}} body
 * variable — configure its name in WHATSAPP_OWNER_ALERT_TEMPLATE. With no template configured,
 * this returns false rather than lying: the callers all have an honest failure path, and a false
 * "sent" is the one outcome that loses the lead invisibly.
 */
const WINDOW_MS = 23.5 * 60 * 60 * 1000; // half an hour of slack under Meta's 24h

export async function notifyOwner(businessId: string, message: string): Promise<boolean> {
  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        notificationPhone: true,
        notificationPhoneVerifiedAt: true,
        whatsappPhoneNumberId: true,
        whatsappAccessToken: true,
      },
    });
    if (!business?.notificationPhone || !business.whatsappPhoneNumberId || !business.whatsappAccessToken) {
      console.warn(`[notifyOwner] business ${businessId} has no notificationPhone configured — skipping`);
      return false;
    }
    const accessToken = decryptSecret(business.whatsappAccessToken);

    const lastInbound = await prisma.conversationMessage.findFirst({
      where: {
        businessId,
        phone: normalizePhone(business.notificationPhone),
        role: "user",
        createdAt: { gte: new Date(Date.now() - WINDOW_MS) },
      },
      select: { id: true },
    });

    if (lastInbound) {
      await sendWhatsAppMessage({
        phoneNumberId: business.whatsappPhoneNumberId, accessToken,
        to: business.notificationPhone, text: message,
      });
    } else {
      const templateName = process.env.WHATSAPP_OWNER_ALERT_TEMPLATE;
      if (!templateName) {
        // Sending free-form here would "succeed" at the API and die in transit. Refusing is what
        // keeps every caller's failure path honest — the voice agent says it could not deliver
        // and collects a callback instead of promising a message nobody will receive.
        console.error(
          `[notifyOwner] owner of ${businessId} has no open 24h window and WHATSAPP_OWNER_ALERT_TEMPLATE is not set — alert NOT sent`
        );
        return false;
      }
      await sendWhatsAppTemplate({
        phoneNumberId: business.whatsappPhoneNumberId, accessToken,
        to: business.notificationPhone,
        templateName,
        languageCode: process.env.WHATSAPP_OWNER_ALERT_TEMPLATE_LANG || "he",
        bodyParams: [message],
      });
    }

    // A send that succeeded is the proof that the number is real and reachable — nothing else we
    // can check establishes that. Recording it here is what makes verification self-healing: a
    // business whose number already works is marked verified by its next ordinary booking alert,
    // without anyone pressing anything, while a business whose number is wrong never gets marked
    // and surfaces on the setup checklist instead of failing silently forever.
    if (!business.notificationPhoneVerifiedAt) {
      await prisma.business
        .update({ where: { id: businessId }, data: { notificationPhoneVerifiedAt: new Date() } })
        .catch((err) => console.error("[notifyOwner] Could not record phone verification (non-fatal):", err));
    }
    return true;
  } catch (err) {
    console.error("Owner notification failed (non-fatal):", err);
    return false;
  }
}
