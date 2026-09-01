import { prisma } from "./prisma.js";
import { decryptSecret } from "./crypto.js";
import { sendWhatsAppMessage, sendWhatsAppTemplate, WhatsAppSendError, RE_ENGAGEMENT_ERROR_CODE } from "../webhook/whatsappClient.js";
import { reminderTemplate, reviewTemplate, type TemplateConfig } from "./whatsappTemplates.js";
import { meterOutboundMessage } from "./wallet.js";
import { instantPartsInTz, dayOfWeekForDate } from "./timezone.js";
import { fmtIlsGrouped } from "./money.js";

/**
 * Send a free-form message, falling back to an approved template when the 24-hour customer service
 * window is closed (Meta error 131047). Returns "sent" on success (either path), or "window_closed"
 * when the window is shut and the template send also failed (e.g. not yet approved by Meta, or the
 * business hasn't created it in their WABA) — in which case the caller marks the item done rather
 * than retrying forever, since retrying the same customer won't reopen their 24h window regardless.
 * Any other (non-window) failure from the free-form attempt is rethrown. A successful send is
 * metered against the business's plan quota — see wallet.ts.
 */
export async function sendWithTemplateFallback(
  businessId: string,
  common: { phoneNumberId: string; accessToken: string; to: string },
  text: string,
  template: TemplateConfig,
  templateParams: string[]
): Promise<"sent" | "window_closed"> {
  try {
    await sendWhatsAppMessage({ ...common, text });
    await meterOutboundMessage(businessId);
    return "sent";
  } catch (err) {
    const windowClosed = err instanceof WhatsAppSendError && err.code === RE_ENGAGEMENT_ERROR_CODE;
    if (!windowClosed) throw err;
    try {
      await sendWhatsAppTemplate({
        ...common,
        templateName: template.name,
        languageCode: template.languageCode,
        bodyParams: templateParams,
      });
      await meterOutboundMessage(businessId);
      return "sent";
    } catch (templateErr) {
      console.warn(`[scheduledMessages] Template send also failed (template not approved/created yet?):`, templateErr);
      return "window_closed";
    }
  }
}

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
    const text = `${name}! 👋 תזכורת לתור שלך ל${appt.service.name} מחר ב-${when} אצל ${appt.business.name}.${addressLine}\n\nלביטול יש לכתוב "בטל תור".`;

    try {
      const outcome = await sendWithTemplateFallback(
        appt.businessId,
        { phoneNumberId: appt.business.whatsappPhoneNumberId, accessToken, to: appt.customer.phone },
        text,
        reminderTemplate(),
        [name, appt.service.name, when, appt.business.name],
      );
      // Mark sent even when the window was closed with no template — retrying next hour would only
      // hit the same wall, and the appointment is <25h away regardless.
      await prisma.appointment.update({ where: { id: appt.id }, data: { reminderSentAt: new Date() } });
      if (outcome === "sent") console.log(`[reminders] Sent reminder for appt ${appt.id}`);
      else console.warn(`[reminders] 24h window closed and no template configured — reminder not delivered for appt ${appt.id}`);
    } catch (err) {
      console.error(`[reminders] Failed for appt ${appt.id}:`, err);
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
      ? `\n\nנשמח לביקורת קצרה ⭐\n${appt.business.googleMapsUrl}`
      : "";
    // Optional referral hook, e.g. "הזמן חבר וקבל 10% הנחה" — configured in settings.
    const referralLine = appt.business.referralText ? `\n\n🎁 ${appt.business.referralText}` : "";
    const text = `${name}! 😊 תודה שביקרת ב${appt.business.name} היום.\nמקווים שנהנית מה${appt.service.name}!${reviewLine}${referralLine}`;

    try {
      const outcome = await sendWithTemplateFallback(
        appt.businessId,
        { phoneNumberId: appt.business.whatsappPhoneNumberId, accessToken, to: appt.customer.phone },
        text,
        reviewTemplate(),
        [name, appt.business.name, appt.service.name],
      );
      await prisma.appointment.update({ where: { id: appt.id }, data: { reviewSentAt: new Date() } });
      if (outcome === "sent") console.log(`[reviews] Sent review request for appt ${appt.id}`);
      else console.warn(`[reviews] 24h window closed and no template configured — review request not delivered for appt ${appt.id}`);
    } catch (err) {
      console.error(`[reviews] Failed for appt ${appt.id}:`, err);
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
    // notificationPhone passes the `not: null` filter as an empty string; Meta then rejects the
    // send with "parameter to is required". Skip these rather than logging a failure every run.
    if (!biz.notificationPhone?.trim()) continue;
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
      await meterOutboundMessage(biz.id);
      await prisma.business.update({ where: { id: biz.id }, data: { lastDigestSentAt: now } });
      console.log(`[digest] Sent morning digest to business ${biz.id}`);
    } catch (err) {
      console.error(`[digest] Failed for business ${biz.id}:`, err);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

const MINUTES_SAVED_PER_BOOKING = 4; // matches the admin billing page's savings calculator estimate

/**
 * Monthly ROI report: on the 1st of each month, message the owner a summary of the value Tori
 * delivered last month (bookings handled, revenue closed via the bot, waitlist saves, time
 * saved) — the antidote to "I forgot why I'm paying for this" cancellations.
 */
export async function runRoiReportJob() {
  const businesses = await prisma.business.findMany({
    where: {
      digestEnabled: true,
      notificationPhone: { not: null },
      whatsappPhoneNumberId: { not: null },
      whatsappAccessToken: { not: null },
    },
    select: {
      id: true, name: true, timezone: true, notificationPhone: true,
      whatsappPhoneNumberId: true, whatsappAccessToken: true, lastRoiReportSentAt: true,
    },
  });

  const now = new Date();
  for (const biz of businesses) {
    if (!biz.notificationPhone?.trim()) continue; // empty-string phone slips past the null filter
    const tz = biz.timezone || "Asia/Jerusalem";
    const { year, month, day } = ymdInTz(now, tz);
    if (day !== 1) continue; // only fires on the 1st of the month, local time
    // Guard against duplicates: skip if already sent within the last 25 days.
    if (biz.lastRoiReportSentAt && now.getTime() - biz.lastRoiReportSentAt.getTime() < 25 * 24 * 60 * 60 * 1000) continue;

    // Previous calendar month's window in the business timezone → UTC bounds.
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const startUtc = wallToUtc(prevYear, prevMonth, 1, 0, tz);
    const endUtc = wallToUtc(year, month, 1, 0, tz);

    const [appointments, waitlistFilled] = await Promise.all([
      prisma.appointment.findMany({
        where: { businessId: biz.id, status: "confirmed", createdAt: { gte: startUtc, lt: endUtc } },
        include: { service: true },
      }),
      prisma.waitlistEntry.count({
        where: { businessId: biz.id, notified: true, createdAt: { gte: startUtc, lt: endUtc } },
      }),
    ]);

    if (appointments.length === 0) continue; // nothing meaningful to report

    const revenueIls = appointments.reduce((sum, a) => sum + a.service.priceCents, 0) / 100;
    const hoursSaved = Math.max(1, Math.round((appointments.length * MINUTES_SAVED_PER_BOOKING) / 60));
    const heMonths = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
    const monthName = heMonths[prevMonth - 1];

    const waitlistLine = waitlistFilled > 0 ? `\nמילאה ${waitlistFilled} ביטולים של הרגע האחרון דרך רשימת ההמתנה 🎯` : "";
    const text = `📊 סיכום חודש ${monthName}!\n\nתורי החודש:\n✅ קבעה ${appointments.length} תורים\n💰 הכנסות שנסגרו דרך הבוט: ₪${fmtIlsGrouped(revenueIls)}\n⏱️ חסכה לך כ-${hoursSaved} שעות של התכתבויות מול לקוחות${waitlistLine}\n\nתודה שאתם איתנו! 🙏`;

    try {
      const accessToken = decryptSecret(biz.whatsappAccessToken!);
      await sendWhatsAppMessage({ phoneNumberId: biz.whatsappPhoneNumberId!, accessToken, to: biz.notificationPhone!, text });
      await meterOutboundMessage(biz.id);
      await prisma.business.update({ where: { id: biz.id }, data: { lastRoiReportSentAt: now } });
      console.log(`[roiReport] Sent monthly ROI report to business ${biz.id}`);
    } catch (err) {
      console.error(`[roiReport] Failed for business ${biz.id}:`, err);
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
