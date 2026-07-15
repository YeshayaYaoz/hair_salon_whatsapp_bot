import { prisma } from "./prisma.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";
import { decryptSecret } from "./crypto.js";

/**
 * Releases "pending_payment" holds whose deposit window has passed without payment — otherwise
 * an abandoned payment link would block the slot forever. Runs frequently (every few minutes,
 * see server.ts) since holds are typically short (default 30 min).
 */
export async function runDepositExpiryJob() {
  const expired = await prisma.appointment.findMany({
    where: { status: "pending_payment", depositStatus: "pending", depositExpiresAt: { lt: new Date() } },
    include: {
      service: true,
      customer: true,
      business: { select: { name: true, whatsappPhoneNumberId: true, whatsappAccessToken: true } },
    },
  });

  for (const appt of expired) {
    await prisma.appointment.update({
      where: { id: appt.id },
      data: { status: "cancelled", depositStatus: "none" },
    });
    console.log(`[depositExpiry] Released unpaid hold ${appt.id} (business ${appt.businessId})`);

    if (appt.business.whatsappPhoneNumberId && appt.business.whatsappAccessToken) {
      try {
        const accessToken = decryptSecret(appt.business.whatsappAccessToken);
        await sendWhatsAppMessage({
          phoneNumberId: appt.business.whatsappPhoneNumberId,
          accessToken,
          to: appt.customer.phone,
          text: `היי, המועד ל${appt.service.name} אצל ${appt.business.name} שוחרר כי המקדמה לא התקבלה בזמן. רוצה לנסות לקבוע מחדש? אני כאן 😊`,
        });
      } catch (err) {
        console.error(`[depositExpiry] Failed to notify customer for appt ${appt.id}:`, err);
      }
    }
  }
}
