import type { BusinessHours, Service, StaffMember, FaqEntry } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { instantPartsInTz, zonedDateParts, dayOfWeekForDate } from "../lib/timezone.js";
import { TEMPLATES, isBusinessType } from "../lib/businessTemplates.js";
import {
  LANGUAGE_RULES,
  BREVITY_RULE,
  FORMATTING_RULES,
  CALENDAR_RULES,
  CONVERSATION_AGE_RULE,
  PRICING_RULE,
  PHOTOS_RULE,
  UNIT_FIT_RULE,
  PLACEHOLDER_RULE,
  HONESTY_RULES,
  slotBookingSection,
  inquiryBookingSection,
  AVAILABILITY_LINES,
} from "./rules.js";

/** The system prompt, split so the large unchanging part can be prompt-cached. See the comment
 * at the return statement for why the clock time must stay out of the cacheable block. */
export interface SystemPrompt {
  /** Big, cacheable: business info, services, hours, FAQ, rules. Stable across a conversation. */
  stable: string;
  /** Tiny, changes every minute (current time / open-now). Must go after the cache breakpoint. */
  volatile: string;
}

/** Midnight UTC today, for filtering date-only columns. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** "12.4" for a single day, "12.4-15.4" for a range — how dates are read aloud in Hebrew. */
function formatDateRange(start: Date, end: Date): string {
  const fmt = (d: Date) => `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
  return fmt(start) === fmt(end) ? fmt(start) : `${fmt(start)} עד ${fmt(end)}`;
}

export async function buildSystemPrompt(
  businessId: string,
  customerPhone?: string,
  /** True when the owner's greeting is going out as its own message just before this reply, so the
   *  model must not open with one of its own — see BotResult.greetingText. */
  greetingSentSeparately = false
): Promise<SystemPrompt> {
  const [business, customer] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      include: {
        services: true,
        hours: true,
        staff: true,
        faqEntries: true,
        // Only periods that haven't ended yet: a rule about last Pesach is pure noise in the
        // prompt, and these accumulate year over year.
        specialPeriods: { where: { endDate: { gte: startOfToday() } }, orderBy: { startDate: "asc" }, take: 40 },
      },
    }),
    customerPhone
      ? prisma.customer.findUnique({
          where: { businessId_phone: { businessId, phone: customerPhone } },
          include: { appointments: { where: { status: "confirmed" }, orderBy: { startTime: "desc" }, take: 3, include: { service: true } } },
        })
      : null,
  ]);

  const dayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const hoursText = business.hours
    .sort((a: BusinessHours, b: BusinessHours) => a.dayOfWeek - b.dayOfWeek)
    .map((h: BusinessHours) => `יום ${dayNames[h.dayOfWeek]}: ${fmtMin(h.openMin)}-${fmtMin(h.closeMin)}`)
    .join("\n") || "שעות עבודה לא הוגדרו — הפנה את הלקוח לפנות ישירות למספר העסק.";

  // Overnight verticals measure stays in nights, not minutes. Without this the bot quoted real
  // customers things like "לילה — יחידה זוגית: ₪900 (1440 דקות)", which reads as nonsense.
  const isOvernight = business.businessType === "bnb";

  const servicesText = business.services
    .map((s: Service) => {
      const extras = [s.description, s.imageUrls.length ? `יש ${s.imageUrls.length} תמונות` : null, s.linkUrl ? `מידע נוסף: ${s.linkUrl}` : null]
        .filter(Boolean)
        .join(" — ");
      // Occupancy printed as its own labelled field rather than left inside the prose. Buried in a
      // description it was one clause among several and got read past: a party of six was offered a
      // three-person unit. Only for overnight verticals, where a "service" is a unit people sleep in.
      const guests = isOvernight && s.maxGuests ? ` [עד ${s.maxGuests} אורחים]` : "";
      return `• ${s.name}: ₪${(s.priceCents / 100).toFixed(0)} (${formatDuration(s.durationMin, isOvernight)})${guests}${extras ? ` — ${extras}` : ""}`;
    })
    .join("\n") || "לא הוגדרו שירותים עדיין.";

  const staffText = business.staff.map((s: StaffMember) => s.name).join(", ") || "לא צוין.";
  // Only bother asking about staff preference when there's actually a choice to make —
  // avoid adding an extra required question for single-staff (or staff-less) businesses.
  const staffPromptNote = business.staff.length > 1
    ? `אם הלקוח מציין שם ספציפי של איש/אשת צוות (${staffText}) — העבר את staffName ל-check_availability ול-book_appointment. אחרת אל תשאל מי מבצע את הטיפול; זה לא שלב חובה.`
    : "";

  const faqText = business.faqEntries.length
    ? business.faqEntries.map((f: FaqEntry) => `ש: ${f.question}\nת: ${f.answer}`).join("\n\n")
    : "";

  // Dates on which the business operates differently (holiday pricing, minimum stays, seasonal
  // rules). This does NOT close the calendar — the business is open, the terms differ — so the
  // rule below is about disclosure: say it before quoting, and never work out the new price.
  const specialPeriodsText = business.specialPeriods.length
    ? `\nתאריכים מיוחדים שבהם התנאים שונים מהרגיל:\n${business.specialPeriods
        .map((p) => `• ${p.label}: ${formatDateRange(p.startDate, p.endDate)} — ${p.description}`)
        .join("\n")}
כשלקוח שואל על תאריך שנופל באחת התקופות האלה — אמור לו מראש, לפני כל מחיר, שבתאריך הזה התנאים שונים, וציין מה בדיוק שונה כפי שכתוב כאן. אל תחשב את המחיר החדש בעצמך גם אם כתוב "פי 2" או "תוספת" — מסור את הכלל כפי שהוא, ואמור שהסכום המדויק ייסגר מול בעל העסק.\n`
    : "";

  const personalityNote = business.botPersonality ? `\nסגנון תקשורת: ${business.botPersonality}\n` : "";
  // Owners write greetings with fill-in-the-blank placeholders — "[פירוט של כל הצימרים]",
  // "[כתובת האתר]" — expecting them to be substituted. They can't be substituted deterministically
  // (each owner invents their own wording), so PLACEHOLDER_RULE explains what they mean and, more
  // importantly, what to do when there is nothing to fill one in with.
  const greeting = greetingSentSeparately
    // Already going out verbatim — either as its own message or joined to the top of this reply
    // (see whatsappRoutes). Either way, leaving the text in here would get it half-repeated and the
    // customer would read the same welcome twice. Worded without saying which, because the merge
    // decision is made later, in the webhook that knows about buttons and body limits.
    ? "\nהודעת הפתיחה של העסק כבר נמסרה ללקוח — היא נשלחת אוטומטית ואינה באחריותך. אל תברך, אל תציג את העסק ואל תפתח ב\"שלום\" או ב\"ברוכים הבאים\" — ענה ישירות ולעניין להודעה שהלקוח כתב.\n"
    : business.botGreeting
      ? `\nברכה ראשונה (השתמש בה בפתיחת שיחה חדשה):\n${business.botGreeting}\n${PLACEHOLDER_RULE}\n`
      : "";

  // Anchor the model to the real clock in the business timezone — without this it invents times.
  // Declared before the CRM note because that formats a date too, and rendering it in the server's
  // UTC named the wrong day for any visit in the last two or three hours of a local day.
  const tz = business.timezone || "Asia/Jerusalem";

  let crmNote = "";
  if (customer?.appointments.length) {
    const firstName = customer.name?.split(" ")[0] ?? null;
    const lastAppt = customer.appointments[0];
    const lastDate = lastAppt.startTime.toLocaleDateString("he-IL", { timeZone: tz, day: "numeric", month: "long" });
    const recentServices = [...new Set(customer.appointments.map((a) => a.service.name))].join(", ");
    crmNote = `\nמידע על הלקוח החוזר:
• שם: ${customer.name ?? "לא ידוע"}${firstName ? ` (פנה אליו/ה כ-${firstName})` : ""}
• ביקור אחרון: ${lastDate} — ${lastAppt.service.name}
• שירותים קודמים: ${recentServices}
• ברך בשם, והצע את השירות הרגיל שלו/ה אם לא ציינו שירות.\n`;
  }

  const now = new Date();
  const nowParts = instantPartsInTz(now, tz);
  const dateParts = zonedDateParts(now, tz);
  const todayIso = `${dateParts.year}-${String(dateParts.month).padStart(2, "0")}-${String(dateParts.day).padStart(2, "0")}`;
  const nowHHMM = fmtMin(nowParts.minutes);

  // Deterministic date lookup for the next two weeks, so the model never has to compute a calendar
  // date from a weekday name (e.g. "יום שני") — that arithmetic is a known source of wrong-day
  // bookings (the model once gave two different dates for the same "Monday" in one conversation).
  // The Israeli weekend is Friday-Saturday, not Saturday-Sunday. Left to itself the model applies
  // the Western convention and offers the wrong days — it once told a guest the coming weekend was
  // Saturday+Sunday, which for an overnight rental also means quoting the wrong two nights. Marking
  // the days in the table is deterministic, unlike a rule the model has to remember to apply.
  // Gated on the timezone so this doesn't assert an Israeli week for a business somewhere else.
  const israeliWeek = tz === "Asia/Jerusalem";
  const isWeekendDay = (dow: number) => israeliWeek && (dow === 5 || dow === 6); // Friday, Saturday

  const upcomingDates: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + i));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dow = dayOfWeekForDate(y, m, day);
    const rel = i === 0 ? " (היום)" : i === 1 ? " (מחר)" : "";
    const weekendTag = isWeekendDay(dow) ? " [סופ״ש]" : "";
    upcomingDates.push(`${iso} = יום ${dayNames[dow]}${rel}${weekendTag}`);
  }
  const dateTable = upcomingDates.join("\n");
  const todayHours = business.hours.find((h: BusinessHours) => h.dayOfWeek === nowParts.dayOfWeek);
  const isInquiry = business.bookingModel === "inquiry";
  let openNowNote: string;
  if (isInquiry) {
    // Inquiry-mode businesses (overnight rentals) don't open and close like an appointment
    // business, and typically have no hours configured at all — which would otherwise make this
    // announce "העסק סגור היום" to a guest asking about a stay next month.
    openNowNote = "";
  } else if (!todayHours) {
    openNowNote = `העסק סגור היום (יום ${dayNames[nowParts.dayOfWeek]}). אם לקוח מבקש תור "עכשיו" או "היום" — הסבר בנימוס והצע יום אחר.`;
  } else if (nowParts.minutes < todayHours.openMin) {
    openNowNote = `העסק עדיין סגור כרגע — נפתח היום ב-${fmtMin(todayHours.openMin)}.`;
  } else if (nowParts.minutes >= todayHours.closeMin) {
    openNowNote = `העסק כבר סגור להיום (נסגר ב-${fmtMin(todayHours.closeMin)}). אפשר לקבוע תורים לימים הבאים.`;
  } else {
    openNowNote = `העסק פתוח כרגע (עד ${fmtMin(todayHours.closeMin)} היום).`;
  }

  const cancellationNote = business.cancellationPolicy
    ? `\nמדיניות ביטולים: ${business.cancellationPolicy}\nכאשר לקוח מבטל תור — הזכר את המדיניות בנימוס.\n`
    : "";

  // "כשרלוונטי" was too soft to hold: it left the model to judge when an exclusion mattered, and
  // the moment it always matters is the moment a number is said out loud. A rate quoted without its
  // exclusions is what a guest books on and the owner has to correct at check-in.
  const pricingNote = `\n${PRICING_RULE}${
    business.pricingNotes
      ? `\nכללי תמחור והחרגות: ${business.pricingNotes}\nבכל פעם שאתה מוסר מחיר — מסור גם את ההחרגות האלה באותה הודעה, גם אם לא שאלו.`
      : ""
  }\n`;

  // Vertical vocabulary: tell the bot which words to use for this business's category, so a clinic
  // bot says "מטופל" and a B&B bot wouldn't say "לקוח" like a salon. Falls back to generic terms
  // when no category was chosen.
  const vocabNote = isBusinessType(business.businessType)
    ? (() => {
        const v = TEMPLATES[business.businessType as keyof typeof TEMPLATES].vocabulary;
        // The English line matters as much as the Hebrew one: a reply to an English-speaking
        // customer is composed in English from scratch, so the Hebrew terms above never reach it and
        // the model translates on its own. A B&B's "צימר" went out to guests as "cabin".
        return `\nמינוח לעסק זה: פנה אל מי שמזמין כ"${v.customer}" (רבים: "${v.customerPlural}"), התייחס לאיש/אשת הצוות כ"${v.staff}", ולשירות/פעולה כ"${v.service}". השתמש במונחים האלה באופן טבעי.\nכשאתה עונה באנגלית, אלה המילים המקבילות — ורק הן: "${v.customerEn}" (רבים: "${v.customerPluralEn}"), "${v.staffEn}", "${v.serviceEn}". אל תתרגם את המונחים בעצמך ואל תבחר מילה נרדפת.\n`;
      })()
    : "";

  const availabilityLine = !business.availabilitySuggestionsEnabled
    ? AVAILABILITY_LINES.disabled
    : business.availabilityInfo
      ? AVAILABILITY_LINES.info(business.availabilityInfo)
      : AVAILABILITY_LINES.unknown;

  const bookingSection = isInquiry
    ? inquiryBookingSection(availabilityLine)
    : slotBookingSection(staffPromptNote);

  // Split into a cacheable "stable" block and a tiny "volatile" suffix.
  //
  // Prompt caching matches on an exact prefix. The current clock time (HH:MM) changes every
  // minute, so while it lived inside this block the cache could essentially never hit — we paid
  // full input rate for the entire ~3k-token prompt on every single call, on every provider.
  // Everything that changes per-minute now lives in `volatile`, which providers append AFTER the
  // cache breakpoint; the date table stays here because it only rolls over daily, far longer than
  // the cache TTL.
  const stable = `אתה עוזר ההזמנות של "${business.name}" בוואטסאפ.
טבלת תאריכים לשבועיים הקרובים (השתמש בה תמיד כשלקוח נוקב ביום בשבוע כמו "יום שני" — אל תחשב תאריך בעצמך). הימים המסומנים ב-[סופ״ש] הם סוף השבוע:
${dateTable}
${HONESTY_RULES}
${LANGUAGE_RULES}
${BREVITY_RULE}
${FORMATTING_RULES}
${CALENDAR_RULES}
${CONVERSATION_AGE_RULE}
${PHOTOS_RULE}
${isOvernight ? `${UNIT_FIT_RULE}\n` : ""}
${cancellationNote}${pricingNote}${specialPeriodsText}${vocabNote}${personalityNote}${greeting}${crmNote}
שירותים ומחירים:
${servicesText}

${isInquiry ? "" : `שעות פעילות:
${hoursText}

צוות: ${staffText}`}
כתובת: ${business.address ?? "לא צוין."}
${business.googleMapsUrl
  ? `קישור לניווט (Google Maps): ${business.googleMapsUrl}\nכשלקוח מבקש הוראות הגעה, ניווט, מיקום או "קישור" — שלח לו את הקישור הזה. אל תאמר שאין לך קישור.`
  : "אין קישור ניווט מוגדר לעסק — אם לקוח מבקש הוראות הגעה, מסור את הכתובת והצע לו לפנות לבעל העסק לפרטים."}
${faqText ? `\nשאלות נפוצות:\n${faqText}\n` : ""}
${bookingSection}`;

  const volatile = `היום: ${todayIso} (יום ${dayNames[nowParts.dayOfWeek]}), השעה כעת: ${nowHHMM} (שעון ישראל).${openNowNote ? ` ${openNowNote}` : ""}
אל תנקוב בשעה הנוכחית אחרת מזו — זו השעה האמיתית.`;

  return { stable, volatile };
}

/** Duration is stored in minutes for every vertical (the slot engine's unit), but overnight
 * businesses think and speak in nights — 1440 minutes is "לילה", not "1440 דקות". Falls back to
 * minutes for a stay that isn't a whole number of nights, rather than rounding and misquoting. */
export function formatDuration(durationMin: number, isOvernight: boolean): string {
  if (isOvernight && durationMin % 1440 === 0 && durationMin >= 1440) {
    const nights = durationMin / 1440;
    return nights === 1 ? "לילה" : `${nights} לילות`;
  }
  return `${durationMin} דקות`;
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60).toString().padStart(2, "0");
  const m = (min % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}
