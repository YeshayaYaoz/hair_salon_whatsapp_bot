import { prisma } from "./prisma.js";
import { decryptSecret } from "./crypto.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";

/**
 * The offer text sent to a waitlisted customer. Shared so the automatic path (a slot freeing up)
 * and the manual one (the owner pressing "notify" on the waitlist page) say the same thing —
 * the manual button used to send nothing at all, so there was nothing to keep in sync.
 */
export function waitlistOfferText(params: {
  customerName: string | null;
  serviceName: string;
  businessName: string;
  /**
   * Omitted for the manual button: the owner knows something freed up but the dashboard never asks
   * which slot, so promising a specific time there would be inventing one.
   */
  when?: string;
}): string {
  const name = params.customerName ? params.customerName.split(" ")[0] : "היי";
  const opening = params.when
    ? `פתח מקום ל${params.serviceName} ב-${params.when} אצל ${params.businessName}.`
    : `התפנה מקום ל${params.serviceName} אצל ${params.businessName}.`;
  const reply = params.when
    ? `רוצה לתפוס אותו? אפשר לכתוב "כן" ואשמור לך את המקום!`
    : `רוצה לתפוס אותו? כתבו לנו ונתאם מועד.`;
  return `${name}! 🎉 ${opening}\n${reply}`;
}

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
    const text = waitlistOfferText({
      customerName: entry.customer.name,
      serviceName,
      businessName: business.name,
      when,
    });
    try {
      await sendWhatsAppMessage({ phoneNumberId: business.whatsappPhoneNumberId, accessToken, to: entry.customer.phone, text });
      await prisma.waitlistEntry.update({ where: { id: entry.id }, data: { notified: true } });
    } catch (err) {
      console.error(`[waitlist] Failed to notify ${entry.customer.phone}:`, err);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
