import { prisma } from "./prisma.js";
import { decryptSecret } from "./crypto.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";
import { instantPartsInTz, dayOfWeekForDate } from "./timezone.js";

/** Send 24-hour appointment reminders. Run this job every hour. */
export async function runReminderJob() {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const appointments = await prisma.appointment.findMany({
    where: {
      status: "confirmed",
      reminderSentAt: null,
      startTime: { gte: windowStart, lte: windowEnd },
    },
    include: {
      customer: true,
      service: true,
      business: { select: { name: true, address: true, remindersEnabled: true, whatsappPhoneNumberId: true, whatsappAccessToken: true } },
    },
  });

  for (const appt of appointments) {
    if (!appt.business.remindersEnabled) continue;
    if (!appt.business.whatsappPhoneNumberId || !appt.business.whatsappAccessToken) continue;
    const accessToken = decryptSecret(appt.business.whatsappAccessToken);
    const when = appt.startTime.toLocaleString("he-IL", {
      weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    });
    const name = appt.customer.name ? appt.customer.name.split(" ")[0] : "היי";
    const addressLine = appt.business.address ? `\n📍 ${appt.business.address}` : "";
    const text = `${name}! 👋 תזכורת לתור שלך ל${appt.service.name} מחר ב-${when} אצל ${appt.business.name}.${addressLine}\n\nלביטול כתוב/י "בטל תור".`;

    try {
      await sendWhatsAppMessage({
        phoneNumberId: appt.business.whatsappPhoneNumberId,
        accessToken,
        to: appt.customer.phone,
        text,
      });
      await prisma.appointment.update({ where: { id: appt.id }, data: { reminderSentAt: new Date() } });
      console.log(`[reminders] Sent reminder for appt ${appt.id}`);
    } catch (err: any) {
      const code = err?.response?.data?.error?.code ?? err?.code;
      if (code === 131047) {
        // Customer hasn't messaged within 24h — mark sent to avoid retry loops
        await prisma.appointment.update({ where: { id: appt.id }, data: { reminderSentAt: new Date() } });
        console.warn(`[reminders] Template window closed for appt ${appt.id} (131047)`);
      } else {
        console.error(`[reminders] Failed for appt ${appt.id}:`, err);
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Send post-visit review requests 2 hours after appointment ends. Run this job every hour. */
export async function runReviewJob() {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const appointments = await prisma.appointment.findMany({
    where: {
      status: "confirmed",
      reviewSentAt: null,
      endTime: { gte: windowStart, lte: windowEnd },
    },
    include: {
      customer: true,
      service: true,
      business: { select: { name: true, googleMapsUrl: true, reviewsEnabled: true, referralText: true, whatsappPhoneNumberId: true, whatsappAccessToken: true } },
    },
  });

  for (const appt of appointments) {
    if (!appt.business.reviewsEnabled) continue;
    if (!appt.business.whatsappPhoneNumberId || !appt.business.whatsappAccessToken) continue;
    const accessToken = decryptSecret(appt.business.whatsappAccessToken);
    const name = appt.customer.name ? appt.customer.name.split(" ")[0] : "היי";
    const reviewLine = appt.business.googleMapsUrl
      ? `\n\nנשמח אם תשאיר/י לנו ביקורת קצרה ⭐\n${appt.business.googleMapsUrl}`
      : "";
    // Optional referral hook, e.g. "הזמן חבר וקבל 10% הנחה" — configured in settings.
    const referralLine = appt.business.referralText ? `\n\n🎁 ${appt.business.referralText}` : "";
    const text = `${name}! 😊 תודה שביקרת ב${appt.business.name} היום.\nמקווים שנהנית מה${appt.service.name}!${reviewLine}${referralLine}`;

    try {
      await sendWhatsAppMessage({
        phoneNumberId: appt.business.whatsappPhoneNumberId,
        accessToken,
        to: appt.customer.phone,
        text,
      });
      await prisma.appointment.update({ where: { id: appt.id }, data: { reviewSentAt: new Date() } });
      console.log(`[reviews] Sent review request for appt ${appt.id}`);
    } catch (err: any) {
      const code = err?.response?.data?.error?.code ?? err?.code;
      if (code === 131047) {
        await prisma.appointment.update({ where: { id: appt.id }, data: { reviewSentAt: new Date() } });
        console.warn(`[reviews] Template window closed for appt ${appt.id} (131047)`);
      } else {
        console.error(`[reviews] Failed for appt ${appt.id}:`, err);
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * Morning digest: once per day, message each owner their day's schedule.
 * Runs hourly and fires only for businesses whose local time is in the 07:00–07:59 window
 * and that haven't already received a digest today.
 */
export async function runDigestJob() {
  const businesses = await prisma.business.findMany({
    where: {
      digestEnabled: true,
      notificationPhone: { not: null },
      whatsappPhoneNumberId: { not: null },
      whatsappAccessToken: { not: null },
    },
    select: {
      id: true, name: true, timezone: true, notificationPhone: true,
      whatsappPhoneNumberId: true, whatsappAccessToken: true, lastDigestSentAt: true,
    },
  });

  const now = new Date();
  for (const biz of businesses) {
    const tz = biz.timezone || "Asia/Jerusalem";
    const local = instantPartsInTz(now, tz);
    // Send once, in the 07:00 local hour.
    if (Math.floor(local.minutes / 60) !== 7) continue;
    // Guard against duplicates: skip if already sent within the last 20 hours.
    if (biz.lastDigestSentAt && now.getTime() - biz.lastDigestSentAt.getTime() < 20 * 60 * 60 * 1000) continue;

    // Today's window in the business timezone → UTC bounds.
    const { year, month, day } = ymdInTz(now, tz);
    const startUtc = wallToUtc(year, month, day, 0, tz);
    const endUtc = wallToUtc(year, month, day, 24 * 60, tz);

    const todays = await prisma.appointment.findMany({
      where: { businessId: biz.id, status: "confirmed", startTime: { gte: startUtc, lt: endUtc } },
      include: { customer: true, service: true },
      orderBy: { startTime: "asc" },
    });

    const heDays = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
    const dow = dayOfWeekForDate(year, month, day);
    let text: string;
    if (todays.length === 0) {
      text = `☀️ בוקר טוב! יום ${heDays[dow]}.\nאין לך תורים מתוזמנים להיום. יום נעים! 😊`;
    } else {
      const lines = todays.map((a) => {
        const t = a.startTime.toLocaleTimeString("he-IL", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
        return `• ${t} — ${a.customer.name ?? a.customer.phone} (${a.service.name})`;
      });
      text = `☀️ בוקר טוב! יש לך ${todays.length} תורים היום (יום ${heDays[dow]}):\n${lines.join("\n")}\n\nיום מוצלח! 💪`;
    }

    try {
      const accessToken = decryptSecret(biz.whatsappAccessToken!);
      await sendWhatsAppMessage({ phoneNumberId: biz.whatsappPhoneNumberId!, accessToken, to: biz.notificationPhone!, text });
      await prisma.business.update({ where: { id: biz.id }, data: { lastDigestSentAt: now } });
      console.log(`[digest] Sent morning digest to business ${biz.id}`);
    } catch (err) {
      console.error(`[digest] Failed for business ${biz.id}:`, err);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

// Local helpers to avoid importing the whole timezone module surface here.
function ymdInTz(date: Date, tz: string): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) m[p.type] = p.value;
  return { year: +m.year, month: +m.month, day: +m.day };
}
function wallToUtc(year: number, month: number, day: number, minutes: number, tz: string): Date {
  const hh = Math.floor(minutes / 60), mm = minutes % 60;
  const guess = Date.UTC(year, month - 1, day, hh, mm);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(guess))) map[p.type] = p.value;
  const asUTC = Date.UTC(+map.year, +map.month - 1, +map.day, map.hour === "24" ? 0 : +map.hour, +map.minute, +map.second);
  return new Date(guess - (asUTC - guess));
}
