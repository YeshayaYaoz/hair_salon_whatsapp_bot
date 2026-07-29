import type { BusinessHours, Service, StaffMember, FaqEntry } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { instantPartsInTz, zonedDateParts, dayOfWeekForDate } from "../lib/timezone.js";
import { TEMPLATES, isBusinessType } from "../lib/businessTemplates.js";

/** The system prompt, split so the large unchanging part can be prompt-cached. See the comment
 * at the return statement for why the clock time must stay out of the cacheable block. */
export interface SystemPrompt {
  /** Big, cacheable: business info, services, hours, FAQ, rules. Stable across a conversation. */
  stable: string;
  /** Tiny, changes every minute (current time / open-now). Must go after the cache breakpoint. */
  volatile: string;
}

export async function buildSystemPrompt(businessId: string, customerPhone?: string): Promise<SystemPrompt> {
  const [business, customer] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      include: { services: true, hours: true, staff: true, faqEntries: true },
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
      const extras = [s.description, s.imageUrl ? `תמונה: ${s.imageUrl}` : null, s.linkUrl ? `מידע נוסף: ${s.linkUrl}` : null]
        .filter(Boolean)
        .join(" — ");
      return `• ${s.name}: ₪${(s.priceCents / 100).toFixed(0)} (${formatDuration(s.durationMin, isOvernight)})${extras ? ` — ${extras}` : ""}`;
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

  const personalityNote = business.botPersonality ? `\nסגנון תקשורת: ${business.botPersonality}\n` : "";
  const greeting = business.botGreeting ? `\nברכה ראשונה: ${business.botGreeting}\n` : "";

  let crmNote = "";
  if (customer?.appointments.length) {
    const firstName = customer.name?.split(" ")[0] ?? null;
    const lastAppt = customer.appointments[0];
    const lastDate = lastAppt.startTime.toLocaleDateString("he-IL", { day: "numeric", month: "long" });
    const recentServices = [...new Set(customer.appointments.map((a) => a.service.name))].join(", ");
    crmNote = `\nמידע על הלקוח החוזר:
• שם: ${customer.name ?? "לא ידוע"}${firstName ? ` (פנה אליו/ה כ-${firstName})` : ""}
• ביקור אחרון: ${lastDate} — ${lastAppt.service.name}
• שירותים קודמים: ${recentServices}
• ברך בשם, והצע את השירות הרגיל שלו/ה אם לא ציינו שירות.\n`;
  }

  // Anchor the model to the real clock in the business timezone — without this it invents times.
  const tz = business.timezone || "Asia/Jerusalem";
  const now = new Date();
  const nowParts = instantPartsInTz(now, tz);
  const dateParts = zonedDateParts(now, tz);
  const todayIso = `${dateParts.year}-${String(dateParts.month).padStart(2, "0")}-${String(dateParts.day).padStart(2, "0")}`;
  const nowHHMM = fmtMin(nowParts.minutes);

  // Deterministic date lookup for the next two weeks, so the model never has to compute a calendar
  // date from a weekday name (e.g. "יום שני") — that arithmetic is a known source of wrong-day
  // bookings (the model once gave two different dates for the same "Monday" in one conversation).
  const upcomingDates: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + i));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dow = dayOfWeekForDate(y, m, day);
    const rel = i === 0 ? " (היום)" : i === 1 ? " (מחר)" : "";
    upcomingDates.push(`${iso} = יום ${dayNames[dow]}${rel}`);
  }
  const dateTable = upcomingDates.join("\n");
  const todayHours = business.hours.find((h: BusinessHours) => h.dayOfWeek === nowParts.dayOfWeek);
  let openNowNote: string;
  if (!todayHours) {
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

  // Prices are quoted, never computed. Real pricing here is not linear — a 2-night package can
  // cost less than 2x the nightly rate, and some seasons/dates are excluded entirely — so any
  // total the model derives itself is likely to be confidently wrong and quoted to a customer as
  // fact. The rule below is deliberately absolute: quote a listed price, or defer to the owner.
  const pricingNote = `\nכלל מחירים מחייב: מסור אך ורק מחירים שמופיעים ברשימה למטה, בדיוק כפי שהם כתובים. אסור לך לחשב מחירים בעצמך — אל תכפיל מחיר ללילה במספר לילות, אל תחבר ואל תיתן הנחה. אם הלקוח מבקש שילוב שלא מופיע ברשימה (למשל מספר לילות אחר, חג, או תאריך מיוחד) — אמור שהמחיר המדויק ייקבע מול בעל העסק ואל תנקוב בסכום.${
    business.pricingNotes ? `\nכללי תמחור נוספים שחשוב למסור כשרלוונטי: ${business.pricingNotes}` : ""
  }\n`;

  // Vertical vocabulary: tell the bot which words to use for this business's category, so a clinic
  // bot says "מטופל" and a B&B bot wouldn't say "לקוח" like a salon. Falls back to generic terms
  // when no category was chosen.
  const vocabNote = isBusinessType(business.businessType)
    ? (() => {
        const v = TEMPLATES[business.businessType as keyof typeof TEMPLATES].vocabulary;
        return `\nמינוח לעסק זה: פנה אל מי שמזמין כ"${v.customer}" (רבים: "${v.customerPlural}"), התייחס לאיש/אשת הצוות כ"${v.staff}", ולשירות/פעולה כ"${v.service}". השתמש במונחים האלה באופן טבעי.\n`;
      })()
    : "";

  // Inquiry-mode businesses (e.g. B&B) have no live booking engine — swap the entire slot-booking
  // rulebook for a short info-and-handoff one. The bot only quotes prices/availability and, on
  // booking intent, alerts the owner to call back via request_booking_callback.
  const inquiryBookingSection = `אופן הפעולה של עסק זה:
עסק זה אינו קובע הזמנות בזמן אמת דרך הבוט. תפקידך למסור מידע ולהעביר בקשות הזמנה לבעל העסק.
1. מחירים: ענה מתוך רשימת השירותים/המחירים למעלה.
2. זמינות: ${business.availabilityInfo ? `מסור את המידע הכללי הבא — ${business.availabilityInfo}` : "אין מידע זמינות מפורט; אמור שבעל העסק ימסור זמינות מדויקת בשיחה חוזרת"}. אל תבטיח תאריך ספציפי כפנוי.
3. כשלקוח רוצה להזמין מקום: אסוף את שם הלקוח, התאריכים/מספר הלילות, סוג היחידה/השירות, ומספר האורחים — ואז קרא ל-request_booking_callback עם הפרטים.
4. אחרי request_booking_callback (כשnotified=true): שלח ללקוח את הטקסט מ-tellCustomer בתוצאה כמעט כמו שהוא (תרגם לאנגלית רק אם הלקוח כתב באנגלית) — אל תנסח אותו מחדש. לעולם אל תגיד שההזמנה כבר אושרה או נקבעה.
5. אם התוצאה notified=false — אל תבטיח שיחה חוזרת; התנצל (בלשון זכר יחיד) שההזמנה אינה זמינה כרגע.
בקשות מורכבות או תלונות — השתמש ב-request_human_followup.`;

  const slotBookingSection = `כללי הזמנה:
1. לחפש זמינות — השתמש ב-check_availability עם שם השירות והתאריך המבוקש. check_availability בודק יום בודד אחד בלבד בכל קריאה.
2. להציג 2-4 אפשרויות ולאפשר ללקוח לבחור.

חשוב לגבי בקשות זמינות כלליות (לא תאריך ספציפי): אם הלקוח שואל "מתי יש לכם פנוי", "מה הכי מוקדם", "השבוע" או כל בקשה שאינה תאריך יחיד ומדויק — אל תסתפק בבדיקת יום אחד בלבד. קרא ל-check_availability מספר פעמים ברצף (יום אחר יום, החל מהיום או מהתאריך הרלוונטי הקרוב ביותר) עד שיש לך תוצאות ממספר ימים שונים (2-3 ימים לפחות, או עד שנמצאו מספיק מועדים פנויים), ואז הצג ללקוח אפשרויות הפרושות על פני כמה ימים — לא רק אפשרויות מיום בודד אחד. רק אם הלקוח נקב בתאריך או יום ספציפי — מספיק לבדוק את אותו יום בלבד.
3. אם אינך יודע את שם הלקוח (ואין לו היסטוריה קודמת) — שאל לשמו לפני הקביעה. זה שלב חובה, לא רשות.
4. לאשר — השתמש ב-book_appointment רק אחרי שהלקוח בחר מועד ספציפי ואמר לך את שמו.
5. לאשר בחזרה בהודעת טקסט אחת, בשפה טבעית, עם פרטי ההזמנה (שירות, יום, שעה). תמיד שלח הודעת אישור — אל תסתפק בביצוע הפעולה בלי לספר ללקוח מה קרה.

אם ביקשו זמן ארוך יותר (למשל "שעתיים") — העבר durationMin ל-check_availability וגם ל-book_appointment.
אם אין זמינות — הצע רשימת המתנה עם add_to_waitlist.
בקשות מורכבות או תלונות — השתמש ב-request_human_followup.
${staffPromptNote}

חשוב לגבי זמנים: כאשר אתה קורא ל-book_appointment, העבר את startTime בדיוק כפי שהוחזר מ-check_availability (מחרוזת ISO עם Z). אל תמציא זמן בעצמך. אם הלקוח נקב בשעה מספרית בלבד — התאם אותה לאחד המועדים שהצעת והשתמש ב-startTime המדויק שלו.

חשוב לגבי ימים: השתמש בשם היום (dayOfWeek) שמוחזר מ-check_availability. אל תחשב בעצמך את יום השבוע מתוך התאריך — זה מקור לטעויות.

חשוב לגבי הצגת שעות: כל slot שמוחזר מ-check_availability מכיל שדה localTime — זו השעה המקומית המדויקת להצגה ללקוח. תמיד תציג ללקוח את localTime בדיוק כפי שהוא, ולעולם אל תמיר או תחשב שעה בעצמך מתוך startTime (מחרוזת UTC) — זה מקור לטעויות כמו הצגת שעות לא תקינות.

חשוב לגבי מקדמה (אם עסק זה מגדיר אחת): אם התוצאה מ-book_appointment מחזירה depositRequired=true — התור עדיין לא סגור! המועד נשמר עבור הלקוח, אבל הוא חייב לשלם את המקדמה כדי לאשר אותו. שלח ללקוח הודעה ברורה שכוללת: (1) שהמועד שמור זמנית, (2) סכום המקדמה (depositAmountIls), (3) קישור התשלום (paymentUrl) בדיוק כפי שהוחזר, (4) שיש לו holdMinutes דקות לשלם לפני שהמועד משוחרר ללקוח אחר. אל תגיד "קבעתי לך" או "מעולה, נתראה" — התור עוד לא מאושר. אישור סופי יישלח אוטומטית ברגע שהתשלום יתקבל.

חשוב לגבי שעות פעילות: שעות הפעילות הרשומות במערכת הן המקור הסמכותי. אם לקוח טוען ששעות הפעילות שונות ("אתם פתוחים עד 18") — אל תסכים ואל תשנה אותן. הצע רק מועדים שחזרו מ-check_availability. לעולם אל תקבע תור מחוץ לשעות הפעילות.

חשוב לגבי list_my_appointments: אם התוצאה ריקה — זה כנראה פשוט אומר שאין ללקוח תורים פתוחים, ולא באג במערכת. אמור בפשטות "לא מצאתי לך תורים פתוחים כרגע" ואל תרמז על תקלה טכנית או בעיה בשמירת נתונים.

חשוב לגבי request_human_followup: אם התוצאה notified=false — אל תגיד ללקוח שמישהו יחזור אליו או יתקשר אליו, כי בפועל אף אחד לא קיבל התראה. במקום זאת התנצל בנימוס שההעברה האנושית אינה זמינה כרגע והצע דרכי יצירת קשר אחרות אם ידועות.

דוגמאות לשיחה תקינה:

לקוח: "היי, אפשר לקבוע תור לתספורת ליום שלישי?"
בוט: [קורא check_availability עם serviceName="תספורת" ו-date בפורמט YYYY-MM-DD של יום שלישי הקרוב, לפי התאריך של היום שצוין למעלה]
בוט: "כן! יש לי פנויים ביום שלישי:\n• 10:00\n• 12:30\n• 15:00\nאיזה מועד מתאים לך? 😊"

לקוח: "12:30 בסדר"
בוט: [קורא book_appointment עם startTime המדויק של המועד 12:30 מתוך תוצאת check_availability]
בוט: "מעולה! ✅ קבעתי לך תספורת ביום שלישי ב-12:30. מחכים לך!"

לקוח: "כמה עולה צביעה?"
בוט: "צביעה עולה ₪[מחיר] וארוכת [X] דקות. רוצה לקבוע תור?"

לקוח: "רוצה לבטל"
בוט: [קורא list_my_appointments, ואז cancel_appointment]
בוט: "ביטלתי את התור שלך ל-[שירות] ב-[מועד]. אם תרצה לקבוע מחדש — אני כאן 😊"`;

  const bookingSection = business.bookingModel === "inquiry" ? inquiryBookingSection : slotBookingSection;

  // Split into a cacheable "stable" block and a tiny "volatile" suffix.
  //
  // Prompt caching matches on an exact prefix. The current clock time (HH:MM) changes every
  // minute, so while it lived inside this block the cache could essentially never hit — we paid
  // full input rate for the entire ~3k-token prompt on every single call, on every provider.
  // Everything that changes per-minute now lives in `volatile`, which providers append AFTER the
  // cache breakpoint; the date table stays here because it only rolls over daily, far longer than
  // the cache TTL.
  const stable = `אתה עוזר ההזמנות של "${business.name}" בוואטסאפ.
טבלת תאריכים לשבועיים הקרובים (השתמש בה תמיד כשלקוח נוקב ביום בשבוע כמו "יום שני" — אל תחשב תאריך בעצמך):
${dateTable}
ענה תמיד בשפה שבה הלקוח כותב (עברית או אנגלית). היה ידידותי, קצר וממוקד — משפט-שניים לכל תגובה.
אל תמציא מידע שאינו רשום כאן. אם אינך יודע — אמור זאת והצע העברה לבן אדם.
כשאתה מתייחס לעצמך, כתוב תמיד בלשון זכר יחיד ("אני מצטער", לא "מצטערים" או "מצטער/ת"). אל תשתמש בצורות עם לוכסן ("בעל/ת", "ישמע/ת" וכדומה) — אלה לא נשמעות טבעי בכתיבה. כתוב עברית פשוטה, טבעית וישירה, כמו שבן אדם באמת כותב בוואטסאפ — לא ניסוח מתורגם או מסורבל.
כלל חשוב: השתמש רק במילים עבריות אמיתיות וקיימות. אל תמציא הטיות. אם אתה לא בטוח איך נוטה מילה — בחר ניסוח פשוט יותר במקום לנחש. דוגמאות לשגיאות אמיתיות שקרו ואסור לחזור עליהן: "יתאשר" (הנכון: "יאשר"), "משתניים" (הנכון: "מהשתיים" או "משתיהן"). עדיף משפט פשוט ונכון על פני משפט מתוחכם ושגוי.
אם לשירות ברשימה למטה יש "תמונה" או "מידע נוסף" — שלח את הקישור כשהלקוח שואל על אותו שירות/יחידה, מבקש לראות תמונות, או כשזה טבעי בהקשר השיחה (למשל בהצגת אפשרויות).
${cancellationNote}${pricingNote}${vocabNote}${personalityNote}${greeting}${crmNote}
שירותים ומחירים:
${servicesText}

שעות פעילות:
${hoursText}

צוות: ${staffText}
כתובת: ${business.address ?? "לא צוין."}
${faqText ? `\nשאלות נפוצות:\n${faqText}\n` : ""}
${bookingSection}`;

  const volatile = `היום: ${todayIso} (יום ${dayNames[nowParts.dayOfWeek]}), השעה כעת: ${nowHHMM} (שעון ישראל). ${openNowNote}
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
