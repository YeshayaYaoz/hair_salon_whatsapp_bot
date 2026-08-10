import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-5";

/**
 * Higher than the booking bot's 0.2, deliberately.
 *
 * The bot quotes prices and confirms times, where any variation is a liability. This writes cold
 * outreach, where the entire premise is that each message references something specific about that
 * business and doesn't read like a template — at 0.2 every message would come out near-identical,
 * which is exactly what makes outreach look like spam. Left creative, with the Hebrew-correctness
 * rules in SYSTEM_PROMPT carrying the load instead: previously there were none, so this had the
 * same invented-Hebrew exposure as the bot, on the copy that forms a prospect's first impression.
 */
const TEMPERATURE = 0.7;

export interface OutreachLeadContext {
  name: string;
  category: string | null;
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
  website: string | null;
  whatsappDetected: boolean;
  hasOnlineBooking: boolean | null;
  hasContactForm: boolean | null;
  websiteStale: boolean | null;
  notes: string | null;
}

export interface OutreachDraft {
  subject: string | null; // null for manual_call (no subject line)
  body: string;
}

const SYSTEM_PROMPT = `אתה כותב הודעות יזומות (cold outreach) מטעם "תורי" — בוט וואטסאפ מבוסס AI שקובע תורים אוטומטית עבור עסקים קטנים (מספרות, קליניקות, סטודיו) בישראל. אתה כותב בשם צוות המכירות של תורי, לא בשם העסק עצמו.

ההודעה מזמינה את העסק להצטרף לפיילוט של תורי: חודש, בעלות של 80 ש"ח.

כללים:
- כתוב בעברית טבעית, ישירה, לא "משווקת" מדי — כמו הודעה אישית ממישהו שבאמת התעניין בעסק הספציפי הזה, לא תבנית גנרית.
- התייחס לפרט קונקרטי אחד מהעסק (למשל: "ראיתי שאין לכם מערכת הזמנות אונליין", "שמתי לב שיש לכם המון ביקורות אבל האתר לא עודכן") — לא רשימת תכונות של תורי.
- קצר. הודעת מייל = 4-6 משפטים. תסריט שיחה = נקודות קצרות, לא נאום.
- ההצעה היא הזמנה לפיילוט של חודש בעלות של 80 ש"ח. ציין את שני הפרטים האלה במפורש, ובדיוק כך — הם הסיבה המרכזית שההודעה שווה קריאה. אל תוסיף עליהם שום פרט מסחרי אחר: לא מה יקרה בתום החודש, לא מחיר עתידי, ולא הנחה או מבצע. אלה דברים שלא סוכמו, והמצאה שלהם היא הבטחה שהעסק יחזיק אותנו בה.
- אל תבטיח דברים לא נכונים (לוחות זמנים, תוצאות מספריות) — המטרה היא לגרום לעסק להצטרף לפיילוט, לא לסגור עסקה מלאה בהודעה אחת.
- סיום עם קריאה לפעולה ברורה אחת שמזמינה להצטרף לפיילוט (למשל: "רוצה שאצרף אתכם לפיילוט?").
- עברית תקנית בלבד: השתמש רק במילים וצורות קיימות, ואל תמציא הטיות. ביטויים קבועים ("ברוך הבא", "נעים להכיר", "בשעה טובה") נכתבים תמיד בדיוק כמו שהם — וריאציה על ביטוי קבוע היא שגיאה גם אם היא נשמעת תקנית. אם אינך בטוח בהטיה של מילה — נסח פשוט יותר במקום לנחש.`;

function buildLeadSummary(lead: OutreachLeadContext, scoreBreakdown: Record<string, number> | null): string {
  const facts: string[] = [
    `שם העסק: ${lead.name}`,
    lead.category ? `קטגוריה: ${lead.category}` : "",
    lead.address ? `כתובת: ${lead.address}` : "",
    lead.rating != null ? `דירוג גוגל: ${lead.rating} (${lead.reviewCount ?? 0} ביקורות)` : "",
    `יש אתר: ${lead.website ? "כן" : "לא"}`,
    `וואטסאפ מזוהה באתר/בפרופיל: ${lead.whatsappDetected ? "כן" : "לא"}`,
    `מערכת הזמנות אונליין: ${lead.hasOnlineBooking === null ? "לא ידוע" : lead.hasOnlineBooking ? "כן" : "לא"}`,
    `טופס יצירת קשר: ${lead.hasContactForm === null ? "לא ידוע" : lead.hasContactForm ? "כן" : "לא"}`,
    lead.websiteStale ? "האתר נראה לא מעודכן" : "",
    lead.notes ? `הערות פנימיות: ${lead.notes}` : "",
  ].filter(Boolean);

  if (scoreBreakdown) {
    const top = Object.entries(scoreBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k} (${v})`);
    facts.push(`הגורמים החזקים ביותר בציון: ${top.join(", ")}`);
  }

  return facts.join("\n");
}

/** Drafts one outreach message via Claude — never auto-sent, always saved as a draft for the
 * operator to review/edit/approve before anything goes out (see OutreachMessage.approvalStatus). */
export async function generateOutreachDraft(
  lead: OutreachLeadContext,
  scoreBreakdown: Record<string, number> | null,
  channel: "email" | "manual_call",
  angle: string
): Promise<OutreachDraft> {
  const leadSummary = buildLeadSummary(lead, scoreBreakdown);
  const task =
    channel === "email"
      ? `כתוב טיוטת מייל יזום (subject + body) לבעל/ת העסק. השב בפורמט JSON בלבד: {"subject": "...", "body": "..."}.`
      : `כתוב תסריט קצר לשיחת טלפון יזומה (בולטים, לא נאום רציף). השב בפורמט JSON בלבד: {"body": "..."}.`;

  const angleNote =
    angle === "follow_up_1"
      ? 'זו הודעת מעקב (follow-up) — הראשונה כבר נשלחה ולא הייתה תגובה. קצר יותר, לא חוזר על אותו תוכן. ההזמנה לפיילוט של חודש ב-80 ש"ח עדיין עומדת, אבל אל תציג אותה כאילו היא חדשה.'
      : "זו ההודעה הראשונה שנשלחת לעסק הזה.";

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    temperature: TEMPERATURE,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `${angleNote}\n\nפרטי העסק:\n${leadSummary}\n\n${task}`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

  return {
    subject: channel === "email" ? (parsed.subject ?? null) : null,
    body: parsed.body ?? text.trim(),
  };
}
