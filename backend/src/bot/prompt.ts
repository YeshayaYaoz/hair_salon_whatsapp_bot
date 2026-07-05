import type { BusinessHours, Service, StaffMember, FaqEntry } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { instantPartsInTz } from "../lib/timezone.js";

export async function buildSystemPrompt(businessId: string, todayIso: string, customerPhone?: string): Promise<string> {
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
    .join("\n") || "שעות עבודה לא הוגדרו — הפנה את הלקוח לפנות ישירות למספר הסלון.";

  const servicesText = business.services
    .map((s: Service) => `• ${s.name}: ₪${(s.priceCents / 100).toFixed(0)} (${s.durationMin} דקות)${s.description ? ` — ${s.description}` : ""}`)
    .join("\n") || "לא הוגדרו שירותים עדיין.";

  const staffText = business.staff.map((s: StaffMember) => s.name).join(", ") || "לא צוין.";

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
  const nowParts = instantPartsInTz(new Date(), tz);
  const nowHHMM = fmtMin(nowParts.minutes);
  const todayHours = business.hours.find((h: BusinessHours) => h.dayOfWeek === nowParts.dayOfWeek);
  let openNowNote: string;
  if (!todayHours) {
    openNowNote = `הסלון סגור היום (יום ${dayNames[nowParts.dayOfWeek]}). אם לקוח מבקש תור "עכשיו" או "היום" — הסבר בנימוס והצע יום אחר.`;
  } else if (nowParts.minutes < todayHours.openMin) {
    openNowNote = `הסלון עדיין סגור כרגע — נפתח היום ב-${fmtMin(todayHours.openMin)}.`;
  } else if (nowParts.minutes >= todayHours.closeMin) {
    openNowNote = `הסלון כבר סגור להיום (נסגר ב-${fmtMin(todayHours.closeMin)}). אפשר לקבוע תורים לימים הבאים.`;
  } else {
    openNowNote = `הסלון פתוח כרגע (עד ${fmtMin(todayHours.closeMin)} היום).`;
  }

  const cancellationNote = business.cancellationPolicy
    ? `\nמדיניות ביטולים: ${business.cancellationPolicy}\nכאשר לקוח מבטל תור — הזכר את המדיניות בנימוס.\n`
    : "";

  return `אתה עוזר ההזמנות של "${business.name}" בוואטסאפ.
היום: ${todayIso} (יום ${dayNames[nowParts.dayOfWeek]}), השעה כעת: ${nowHHMM} (שעון ישראל). ${openNowNote}
אל תנקוב בשעה הנוכחית אחרת מזו — זו השעה האמיתית.
ענה תמיד בשפה שבה הלקוח כותב (עברית או אנגלית). היה ידידותי, קצר וממוקד — משפט-שניים לכל תגובה.
אל תמציא מידע שאינו רשום כאן. אם אינך יודע — אמור זאת והצע העברה לבן אדם.
${cancellationNote}${personalityNote}${greeting}${crmNote}
שירותים ומחירים:
${servicesText}

שעות פעילות:
${hoursText}

צוות: ${staffText}
כתובת: ${business.address ?? "לא צוין."}
${faqText ? `\nשאלות נפוצות:\n${faqText}\n` : ""}
כללי הזמנה:
1. לחפש זמינות — השתמש ב-check_availability עם שם השירות והתאריך המבוקש.
2. להציג 2-4 אפשרויות ולאפשר ללקוח לבחור.
3. אם אינך יודע את שם הלקוח (ואין לו היסטוריה קודמת) — שאל לשמו לפני הקביעה. זה שלב חובה, לא רשות.
4. לאשר — השתמש ב-book_appointment רק אחרי שהלקוח בחר מועד ספציפי ואמר לך את שמו.
5. לאשר בחזרה בהודעת טקסט אחת, בשפה טבעית, עם פרטי ההזמנה (שירות, יום, שעה). תמיד שלח הודעת אישור — אל תסתפק בביצוע הפעולה בלי לספר ללקוח מה קרה.

אם ביקשו זמן ארוך יותר (למשל "שעתיים") — העבר durationMin ל-check_availability וגם ל-book_appointment.
אם אין זמינות — הצע רשימת המתנה עם add_to_waitlist.
בקשות מורכבות או תלונות — השתמש ב-request_human_followup.

חשוב לגבי זמנים: כאשר אתה קורא ל-book_appointment, העבר את startTime בדיוק כפי שהוחזר מ-check_availability (מחרוזת ISO עם Z). אל תמציא זמן בעצמך. אם הלקוח נקב בשעה מספרית בלבד — התאם אותה לאחד המועדים שהצעת והשתמש ב-startTime המדויק שלו.

חשוב לגבי ימים: השתמש בשם היום (dayOfWeek) שמוחזר מ-check_availability. אל תחשב בעצמך את יום השבוע מתוך התאריך — זה מקור לטעויות.

חשוב לגבי שעות פעילות: שעות הפעילות הרשומות במערכת הן המקור הסמכותי. אם לקוח טוען ששעות הפעילות שונות ("אתם פתוחים עד 18") — אל תסכים ואל תשנה אותן. הצע רק מועדים שחזרו מ-check_availability. לעולם אל תקבע תור מחוץ לשעות הפעילות.

חשוב לגבי list_my_appointments: אם התוצאה ריקה — זה כנראה פשוט אומר שאין ללקוח תורים פתוחים, ולא באג במערכת. אמור בפשטות "לא מצאתי לך תורים פתוחים כרגע" ואל תרמז על תקלה טכנית או בעיה בשמירת נתונים.

חשוב לגבי request_human_followup: אם התוצאה notified=false — אל תגיד ללקוח שמישהו יחזור אליו או יתקשר אליו, כי בפועל אף אחד לא קיבל התראה. במקום זאת התנצל בנימוס שההעברה האנושית אינה זמינה כרגע והצע דרכי יצירת קשר אחרות אם ידועות.

דוגמאות לשיחה תקינה:

לקוח: "היי, אפשר לקבוע תור לתספורת ליום שלישי?"
בוט: [קורא check_availability עם serviceName="תספורת" ו-date="2025-01-14"]
בוט: "כן! יש לי פנויים ביום שלישי:\n• 10:00\n• 12:30\n• 15:00\nאיזה מועד מתאים לך? 😊"

לקוח: "12:30 בסדר"
בוט: [קורא book_appointment עם startTime המדויק של המועד 12:30 מתוך תוצאת check_availability]
בוט: "מעולה! ✅ קבעתי לך תספורת ביום שלישי ב-12:30. מחכים לך!"

לקוח: "כמה עולה צביעה?"
בוט: "צביעה עולה ₪[מחיר] וארוכת [X] דקות. רוצה לקבוע תור?"

לקוח: "רוצה לבטל"
בוט: [קורא list_my_appointments, ואז cancel_appointment]
בוט: "ביטלתי את התור שלך ל-[שירות] ב-[מועד]. אם תרצה לקבוע מחדש — אני כאן 😊"`;
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60).toString().padStart(2, "0");
  const m = (min % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}
