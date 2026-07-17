import { prisma } from "./prisma.js";
import { decryptSecret } from "./crypto.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";

/**
 * Sends a WhatsApp message to the business owner's own notification number — used for new-booking
 * alerts, human-handoff requests, etc. Shared between the WhatsApp bot and the voice bot (Cartesia
 * tool calls) so both notify the owner the same way. Returns true only if the owner was actually
 * reachable and the send succeeded.
 */
export async function notifyOwner(businessId: string, message: string): Promise<boolean> {
  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { notificationPhone: true, whatsappPhoneNumberId: true, whatsappAccessToken: true },
    });
    if (!business?.notificationPhone || !business.whatsappPhoneNumberId || !business.whatsappAccessToken) {
      console.warn(`[notifyOwner] business ${businessId} has no notificationPhone configured — skipping`);
      return false;
    }
    const accessToken = decryptSecret(business.whatsappAccessToken);
    await sendWhatsAppMessage({ phoneNumberId: business.whatsappPhoneNumberId, accessToken, to: business.notificationPhone, text: message });
    return true;
  } catch (err) {
    console.error("Owner notification failed (non-fatal):", err);
    return false;
  }
}
