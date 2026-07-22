/**
 * Category templates (Phase 1 of the vertical-templates roadmap).
 *
 * A template is NOT a separate booking engine — it's a preset bundle + vocabulary skin over the
 * existing slot-based appointment model. Picking a category on first login pre-fills sensible
 * defaults (deposit, policy, tone), seeds a few example services the owner then edits, and swaps
 * the words the bot/dashboard use ("מטופל" for a clinic vs "לקוח" for a salon).
 *
 * All four v1 verticals here are Tier 1 (slot, 1:1) and require zero booking-engine changes.
 * Future tiers (class-with-capacity → fitness/yoga; date-range → B&B/boarding) will extend this
 * list once those models exist.
 */

export const BUSINESS_TYPES = ["salon", "barber", "clinic", "aesthetics"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export function isBusinessType(v: unknown): v is BusinessType {
  return typeof v === "string" && (BUSINESS_TYPES as readonly string[]).includes(v);
}

export interface SeedService {
  name: string;
  durationMin: number;
  priceCents: number;
  color: string;
}

/** Words the bot's prompt and the dashboard labels read from, so each vertical speaks its language. */
export interface Vocabulary {
  customer: string; // singular, e.g. "לקוח" / "מטופל"
  customerPlural: string;
  staff: string; // e.g. "מטפל/ת" / "רופא/ה"
  service: string; // e.g. "טיפול" / "בדיקה"
}

/** Field presets applied when a category is chosen. Strings only overwrite empty fields; the
 * boolean/number toggles only apply on the very first category selection (see applyTemplate). */
export interface TemplatePresets {
  botPersonality: string;
  cancellationPolicy: string;
  referralText: string;
  remindersEnabled: boolean;
  reviewsEnabled: boolean;
  digestEnabled: boolean;
  depositEnabled: boolean;
  depositAmountIls: number;
  depositHoldMinutes: number;
}

export interface BusinessTemplate {
  type: BusinessType;
  emoji: string;
  labelHe: string;
  labelEn: string;
  descriptionHe: string;
  presets: TemplatePresets;
  seedServices: SeedService[];
  vocabulary: Vocabulary;
}

export const TEMPLATES: Record<BusinessType, BusinessTemplate> = {
  salon: {
    type: "salon",
    emoji: "💇",
    labelHe: "מכון יופי / מספרה",
    labelEn: "Salon & Barber",
    descriptionHe: "תספורות, צבע, פן וטיפולי שיער. תזכורות יום לפני ובקשת ביקורת אחרי הביקור.",
    presets: {
      botPersonality:
        "דבר/י בטון חברותי, חם ועדכני. השתמש/י באימוג'ים במידה. הלקוחות מגיעים לפינוק — תעביר/י תחושה נעימה ומזמינה.",
      cancellationPolicy:
        "ניתן לבטל או לשנות תור עד 24 שעות מראש ללא עלות. ביטול מאוחר יותר עלול להיות כרוך בחיוב.",
      referralText: "אהבת/ה? ספר/י לחברים — קבל/י הנחה על הביקור הבא כשחבר/ה מגיע/ה בהמלצתך 💇",
      remindersEnabled: true,
      reviewsEnabled: true,
      digestEnabled: true,
      depositEnabled: false,
      depositAmountIls: 0,
      depositHoldMinutes: 30,
    },
    seedServices: [
      { name: "תספורת", durationMin: 30, priceCents: 8000, color: "#8b5cf6" },
      { name: "צבע", durationMin: 90, priceCents: 25000, color: "#ec4899" },
      { name: "פן", durationMin: 45, priceCents: 12000, color: "#f59e0b" },
    ],
    vocabulary: { customer: "לקוח", customerPlural: "לקוחות", staff: "מספר/ית", service: "טיפול" },
  },

  barber: {
    type: "barber",
    emoji: "✂️",
    labelHe: "ברברשופ",
    labelEn: "Barbershop",
    descriptionHe: "תספורות גברים, זקן וגילוח. מהיר, ישיר, עם תזכורות יום לפני.",
    presets: {
      botPersonality:
        "דבר/י בטון ישיר, קליל וחברי. תכל'ס ולעניין, בלי יותר מדי מילים. הלקוחות רוצים לקבוע מהר ולזוז.",
      cancellationPolicy: "אפשר לבטל או להזיז תור עד 12 שעות מראש. ביטול של הרגע האחרון פוגע בתור של מישהו אחר.",
      referralText: "מרוצה? תביא חבר וקבל הנחה על הבא בתור ✂️",
      remindersEnabled: true,
      reviewsEnabled: true,
      digestEnabled: true,
      depositEnabled: false,
      depositAmountIls: 0,
      depositHoldMinutes: 30,
    },
    seedServices: [
      { name: "תספורת גבר", durationMin: 30, priceCents: 7000, color: "#0ea5e9" },
      { name: "תספורת + זקן", durationMin: 45, priceCents: 10000, color: "#14b8a6" },
      { name: "גילוח מגבת חמה", durationMin: 30, priceCents: 8000, color: "#64748b" },
    ],
    vocabulary: { customer: "לקוח", customerPlural: "לקוחות", staff: "ברבר", service: "תספורת" },
  },

  clinic: {
    type: "clinic",
    emoji: "🏥",
    labelHe: "קליניקה רפואית",
    labelEn: "Health Clinic",
    descriptionHe: "בדיקות, ייעוצים וטיפולים. טון מקצועי ודיסקרטי, תזכורות עם הנחיות הכנה, ותשלום על אי-הגעה.",
    presets: {
      botPersonality:
        "דבר/י בטון רגוע, מקצועי ודיסקרטי. שמור/י על פרטיות המטופל, הימנע/י משאלות רפואיות מפורטות, והפנה/י לצוות בכל מקרה שאינו קביעת/שינוי תור.",
      cancellationPolicy:
        "ביטול עד 48 שעות מראש ללא עלות. אי-הגעה או ביטול מאוחר עלולים להיות כרוכים בדמי ביטול.",
      referralText: "",
      remindersEnabled: true,
      reviewsEnabled: false,
      digestEnabled: true,
      depositEnabled: true,
      depositAmountIls: 100,
      depositHoldMinutes: 60,
    },
    seedServices: [
      { name: "ייעוץ ראשוני", durationMin: 30, priceCents: 30000, color: "#3b82f6" },
      { name: "בדיקה", durationMin: 20, priceCents: 25000, color: "#22c55e" },
      { name: "טיפול המשך", durationMin: 45, priceCents: 40000, color: "#6366f1" },
    ],
    vocabulary: { customer: "מטופל", customerPlural: "מטופלים", staff: "רופא/ה", service: "בדיקה" },
  },

  aesthetics: {
    type: "aesthetics",
    emoji: "✨",
    labelHe: "קוסמטיקה ואסתטיקה",
    labelEn: "Aesthetics",
    descriptionHe: "טיפולי פנים, לייזר וקוסמטיקה. טון מלוטש ואכפתי, תזכורות עם הנחיות הכנה ומקדמה קטנה.",
    presets: {
      botPersonality:
        "דבר/י בטון מלוטש, אכפתי ומרגיע. הדגש/י תוצאה ופינוק, והקפד/י על מקצועיות. במידת הצורך ציין/י הנחיות הכנה לטיפול.",
      cancellationPolicy: "ניתן לבטל או לשנות תור עד 48 שעות מראש. ביטול מאוחר יותר עלול להיות כרוך בדמי ביטול.",
      referralText: "אהבת/ה את התוצאה? הזמיני חברה וקבלו שתיכן הנחה על הטיפול הבא ✨",
      remindersEnabled: true,
      reviewsEnabled: true,
      digestEnabled: true,
      depositEnabled: true,
      depositAmountIls: 50,
      depositHoldMinutes: 45,
    },
    seedServices: [
      { name: "ניקוי פנים", durationMin: 60, priceCents: 28000, color: "#f472b6" },
      { name: "טיפול לייזר", durationMin: 30, priceCents: 35000, color: "#a855f7" },
      { name: "מניקור/פדיקור", durationMin: 45, priceCents: 12000, color: "#fb7185" },
    ],
    vocabulary: { customer: "לקוחה", customerPlural: "לקוחות", staff: "קוסמטיקאית", service: "טיפול" },
  },
};

export function listTemplates(): BusinessTemplate[] {
  return BUSINESS_TYPES.map((t) => TEMPLATES[t]);
}
