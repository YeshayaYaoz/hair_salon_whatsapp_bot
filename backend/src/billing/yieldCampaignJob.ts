import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { decryptSecret } from "../lib/crypto.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";
import { instantPartsInTz, zonedDateParts, zonedWallTimeToUtc } from "../lib/timezone.js";
import { SLOT_BLOCKING_STATUSES } from "../booking/availability.js";

const EMPTY_SLOT_THRESHOLD = 0.3; // trigger the campaign once >30% of tomorrow's open hours are empty
const LAPSED_DAYS = 60; // customers with no visit in this many days are considered "lapsed"
const DEFAULT_DISCOUNT_PERCENT = 10;
const MAX_CANDIDATES = 15; // keep the outreach batch small and manageable for the owner to approve

export interface PendingYieldCampaign {
  date: string; // YYYY-MM-DD, the day being filled
  candidateCustomerIds: string[];
  discountPercent: number;
  emptySlots: number;
  createdAt: string;
}

/** Daily scan (fires once per business at ~18:00 local time): if tomorrow's schedule is mostly
 * empty, ask the owner via WhatsApp whether to proactively offer a discount to lapsed customers
 * to fill it. The owner's "כן"/"לא" reply is handled in whatsappRoutes.ts, not here. */
export async function runYieldCampaignJob(): Promise<void> {
  const businesses = await prisma.business.findMany({
    where: {
      notificationPhone: { not: null },
      whatsappPhoneNumberId: { not: null },
      whatsappAccessToken: { not: null },
      pendingYieldCampaign: { equals: Prisma.DbNull }, // don't pile a new offer on top of one still awaiting a reply
    },
    select: {
      id: true, name: true, timezone: true,
      notificationPhone: true, whatsappPhoneNumberId: true, whatsappAccessToken: true,
    },
  });

  const now = new Date();
  for (const biz of businesses) {
    const tz = biz.timezone || "Asia/Jerusalem";
    const local = instantPartsInTz(now, tz);
    if (Math.floor(local.minutes / 60) !== 18) continue; // only fires in the 18:00 local hour

    try {
      await scanBusiness(biz, tz, now);
    } catch (err) {
      console.error(`[yieldCampaign] Failed for business ${biz.id}:`, err);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function scanBusiness(
  biz: { id: string; name: string; notificationPhone: string | null; whatsappPhoneNumberId: string | null; whatsappAccessToken: string | null },
  tz: string,
  now: Date
): Promise<void> {
  const tomorrowUtcNoon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const { year, month, day, dayOfWeek } = zonedDateParts(tomorrowUtcNoon, tz);

  const hours = await prisma.businessHours.findUnique({ where: { businessId_dayOfWeek: { businessId: biz.id, dayOfWeek } } });
  if (!hours) return; // closed tomorrow — nothing to fill

  const totalOpenMin = hours.closeMin - hours.openMin;
  if (totalOpenMin <= 0) return;

  const dayStartUtc = zonedWallTimeToUtc(year, month, day, 0, tz);
  const dayEndUtc = zonedWallTimeToUtc(year, month, day, 24 * 60, tz);
  const appointments = await prisma.appointment.findMany({
    // Include pending_payment holds, not just confirmed — a slot with an outstanding deposit link
    // is not actually empty, even though nobody has paid for it yet (see availability.ts).
    where: { businessId: biz.id, status: { in: SLOT_BLOCKING_STATUSES }, startTime: { gte: dayStartUtc, lt: dayEndUtc } },
    select: { startTime: true, endTime: true },
  });
  const bookedMin = appointments.reduce((sum, a) => sum + (a.endTime.getTime() - a.startTime.getTime()) / 60_000, 0);
  const emptyRatio = 1 - bookedMin / totalOpenMin;
  if (emptyRatio <= EMPTY_SLOT_THRESHOLD) return;

  const emptySlots = Math.round((totalOpenMin * emptyRatio) / 30); // rough count in 30-min slots

  // Lapsed customers: had at least one past confirmed appointment, nothing more recent than
  // LAPSED_DAYS ago, and no upcoming confirmed appointment already on the books.
  const cutoff = new Date(now.getTime() - LAPSED_DAYS * 24 * 60 * 60 * 1000);
  const customers = await prisma.customer.findMany({
    where: {
      businessId: biz.id,
      appointments: {
        some: { status: "confirmed", startTime: { lt: cutoff } },
        // Also skip anyone with a pending deposit hold, not just a confirmed booking — no point
        // discount-campaigning someone who's already mid-checkout for an upcoming visit.
        none: { status: { in: SLOT_BLOCKING_STATUSES }, startTime: { gte: now } },
      },
    },
    select: { id: true, appointments: { where: { status: "confirmed" }, orderBy: { startTime: "desc" }, take: 1, select: { startTime: true } } },
    take: MAX_CANDIDATES * 3, // over-fetch slightly since the `none` filter above is already precise, just being safe
  });
  const candidates = customers
    .filter((c) => c.appointments[0] && c.appointments[0].startTime < cutoff)
    .slice(0, MAX_CANDIDATES)
    .map((c) => c.id);
  if (candidates.length === 0) return;

  const campaign: PendingYieldCampaign = {
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    candidateCustomerIds: candidates,
    discountPercent: DEFAULT_DISCOUNT_PERCENT,
    emptySlots,
    createdAt: now.toISOString(),
  };

  const text = `היי 👋 זיהיתי שמחר יש לך ${emptySlots} מקומות פנויים ביומן.\nרוצה שאשלח הצעה ל-${candidates.length} לקוחות שלא היו אצלך מעל ${LAPSED_DAYS} יום, עם ${DEFAULT_DISCOUNT_PERCENT}% הנחה אם יגיעו מחר?\n\nיש לענות "כן" כדי לשלוח, או "לא" כדי לדלג.`;

  const accessToken = decryptSecret(biz.whatsappAccessToken!);
  await sendWhatsAppMessage({ phoneNumberId: biz.whatsappPhoneNumberId!, accessToken, to: biz.notificationPhone!, text });
  await prisma.business.update({ where: { id: biz.id }, data: { pendingYieldCampaign: campaign as any } });
  console.log(`[yieldCampaign] Proposed campaign to business ${biz.id}: ${candidates.length} candidates, ${emptySlots} empty slots`);
}

/** Sends the actual discount offer to each candidate customer once the owner confirms. Called
 * from whatsappRoutes.ts when the owner replies affirmatively. */
export async function sendYieldCampaignOffers(
  business: { id: string; name: string; whatsappPhoneNumberId: string; whatsappAccessToken: string },
  campaign: PendingYieldCampaign
): Promise<number> {
  const accessToken = decryptSecret(business.whatsappAccessToken);
  const customers = await prisma.customer.findMany({ where: { id: { in: campaign.candidateCustomerIds } } });

  let sent = 0;
  for (const customer of customers) {
    const name = customer.name ? customer.name.split(" ")[0] : "היי";
    const text = `${name}! 😊 מתגעגעים אליך ב${business.name}. יש לנו מקום פנוי מחר, ואם תגיע/י נשמח להעניק ${campaign.discountPercent}% הנחה על הטיפול. מעוניין/ת לקבוע?`;
    try {
      await sendWhatsAppMessage({ phoneNumberId: business.whatsappPhoneNumberId, accessToken, to: customer.phone, text });
      sent++;
    } catch (err) {
      console.error(`[yieldCampaign] Failed to send offer to customer ${customer.id}:`, err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return sent;
}
