import { prisma } from "./prisma.js";
import { decryptSecret } from "./crypto.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";

/**
 * When a slot frees up, offer it to waitlisted customers (oldest first) over WhatsApp.
 * Fire-and-forget; callers should not await this on the request path.
 */
export async function notifyWaitlist(businessId: string, serviceId: string, serviceName: string, startTime: Date) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { whatsappPhoneNumberId: true, whatsappAccessToken: true, name: true, timezone: true },
  });
  if (!business?.whatsappPhoneNumberId || !business.whatsappAccessToken) return;

  const waitlist = await prisma.waitlistEntry.findMany({
    where: { businessId, serviceId, notified: false },
    include: { customer: true },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  if (waitlist.length === 0) return;

  const accessToken = decryptSecret(business.whatsappAccessToken);
  const when = startTime.toLocaleString("he-IL", {
    timeZone: business.timezone || "Asia/Jerusalem",
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

  for (const entry of waitlist) {
    const name = entry.customer.name ? entry.customer.name.split(" ")[0] : "היי";
    const text = `${name}! 🎉 פתח מקום ל${serviceName} ב-${when} אצל ${business.name}.\nרוצה לתפוס אותו? אפשר לכתוב "כן" ואשמור לך את המקום!`;
    try {
      await sendWhatsAppMessage({ phoneNumberId: business.whatsappPhoneNumberId, accessToken, to: entry.customer.phone, text });
      await prisma.waitlistEntry.update({ where: { id: entry.id }, data: { notified: true } });
    } catch (err) {
      console.error(`[waitlist] Failed to notify ${entry.customer.phone}:`, err);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
