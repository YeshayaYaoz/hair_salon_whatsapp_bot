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

export const BUSINESS_TYPES = ["salon", "barber", "clinic", "aesthetics", "bnb"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export function isBusinessType(v: unknown): v is BusinessType {
  return typeof v === "string" && (BUSINESS_TYPES as readonly string[]).includes(v);
}

/** One day of the seeded opening week. Minutes from midnight, matching BusinessHours. */
export interface SeedHours {
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday
  openMin: number;
  closeMin: number;
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
  staff: string; // e.g. "מטפל" / "רופא"
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
  // "slot" = live booking via the slot engine; "inquiry" = info + owner-callback (no live booking).
  bookingModel: "slot" | "inquiry";
  availabilityInfo: string; // only meaningful in inquiry mode; the general availability the bot quotes
}

export interface BusinessTemplate {
  type: BusinessType;
  emoji: string;
  labelHe: string;
  labelEn: string;
  descriptionHe: string;
  descriptionEn: string;
  presets: TemplatePresets;
  seedServices: SeedService[];
  /**
   * A starting week, seeded on first category selection when the business has none.
   *
   * Opening hours were the only critical setup step that began completely empty — the owner filled
   * in seven days by hand before the bot could book anything, while services arrived pre-filled and
   * merely needed editing. These are a draft to correct, not a claim about this particular salon,
   * and they follow the Israeli working week: Sunday–Thursday full days, a short Friday, closed
   * Saturday. Inquiry-mode verticals seed nothing, since they have no slot engine for hours to
   * constrain.
   */
  seedHours: SeedHours[];
  vocabulary: Vocabulary;
}

export const TEMPLATES: Record<BusinessType, BusinessTemplate> = {
  salon: {
    type: "salon",
    emoji: "💇",
    labelHe: "מכון יופי / מספרה",
    labelEn: "Salon & Barber",
    descriptionHe: "תספורות, צבע, פן וטיפולי שיער. תזכורות יום לפני ובקשת ביקורת אחרי הביקור.",
    descriptionEn: "Haircuts, colour, blow-dry and hair treatments. Day-before reminders, and a review request after the visit.",
    presets: {
      botPersonality:
        "דבר בטון חברותי, חם ועדכני. השתמש באימוג'ים במידה. הלקוחות מגיעים לפינוק — תעביר תחושה נעימה ומזמינה.",
      cancellationPolicy:
        "ניתן לבטל או לשנות תור עד 24 שעות מראש ללא עלות. ביטול מאוחר יותר עלול להיות כרוך בחיוב.",
      referralText: "אהבת? ספר לחברים — קבל הנחה על הביקור הבא כשחבר מגיע בהמלצתך 💇",
      remindersEnabled: true,
      reviewsEnabled: true,
      digestEnabled: true,
      depositEnabled: false,
      depositAmountIls: 0,
      depositHoldMinutes: 30,
      bookingModel: "slot",
      availabilityInfo: "",
    },
    seedServices: [
      { name: "תספורת", durationMin: 30, priceCents: 8000, color: "#8b5cf6" },
      { name: "צבע", durationMin: 90, priceCents: 25000, color: "#ec4899" },
      { name: "פן", durationMin: 45, priceCents: 12000, color: "#f59e0b" },
    ],
    // Salons run late; Friday closes early for Shabbat.
    seedHours: [
      { dayOfWeek: 0, openMin: 540, closeMin: 1140 },
      { dayOfWeek: 1, openMin: 540, closeMin: 1140 },
      { dayOfWeek: 2, openMin: 540, closeMin: 1140 },
      { dayOfWeek: 3, openMin: 540, closeMin: 1140 },
      { dayOfWeek: 4, openMin: 540, closeMin: 1140 },
      { dayOfWeek: 5, openMin: 540, closeMin: 840 },
    ],
    vocabulary: { customer: "לקוח", customerPlural: "לקוחות", staff: "ספר", service: "טיפול" },
  },

  barber: {
    type: "barber",
    emoji: "✂️",
    labelHe: "ברברשופ",
    labelEn: "Barbershop",
    descriptionHe: "תספורות גברים, זקן וגילוח. מהיר, ישיר, עם תזכורות יום לפני.",
    descriptionEn: "Men's cuts, beard trims and shaves. Fast and direct, with day-before reminders.",
    presets: {
      botPersonality:
        "דבר בטון ישיר, קליל וחברי. תכל'ס ולעניין, בלי יותר מדי מילים. הלקוחות רוצים לקבוע מהר ולזוז.",
      cancellationPolicy: "אפשר לבטל או להזיז תור עד 12 שעות מראש. ביטול של הרגע האחרון פוגע בתור של מישהו אחר.",
      referralText: "מרוצה? תביא חבר וקבל הנחה על הבא בתור ✂️",
      remindersEnabled: true,
      reviewsEnabled: true,
      digestEnabled: true,
      depositEnabled: false,
      depositAmountIls: 0,
      depositHoldMinutes: 30,
      bookingModel: "slot",
      availabilityInfo: "",
    },
    seedServices: [
      { name: "תספורת גבר", durationMin: 30, priceCents: 7000, color: "#0ea5e9" },
      { name: "תספורת + זקן", durationMin: 45, priceCents: 10000, color: "#14b8a6" },
      { name: "גילוח מגבת חמה", durationMin: 30, priceCents: 8000, color: "#64748b" },
    ],
    seedHours: [
      { dayOfWeek: 0, openMin: 540, closeMin: 1200 },
      { dayOfWeek: 1, openMin: 540, closeMin: 1200 },
      { dayOfWeek: 2, openMin: 540, closeMin: 1200 },
      { dayOfWeek: 3, openMin: 540, closeMin: 1200 },
      { dayOfWeek: 4, openMin: 540, closeMin: 1200 },
      { dayOfWeek: 5, openMin: 540, closeMin: 840 },
    ],
    vocabulary: { customer: "לקוח", customerPlural: "לקוחות", staff: "ברבר", service: "תספורת" },
  },

  clinic: {
    type: "clinic",
    emoji: "🏥",
    labelHe: "קליניקה רפואית",
    labelEn: "Health Clinic",
    descriptionHe: "בדיקות, ייעוצים וטיפולים. טון מקצועי ודיסקרטי, תזכורות עם הנחיות הכנה, ותשלום על אי-הגעה.",
    descriptionEn: "Check-ups, consultations and treatments. A professional, discreet tone, reminders with preparation instructions, and a no-show charge.",
    presets: {
      botPersonality:
        "דבר בטון רגוע, מקצועי ודיסקרטי. שמור על פרטיות המטופל, הימנע משאלות רפואיות מפורטות, והפנה לצוות בכל מקרה שאינו קביעה או שינוי של תור.",
      cancellationPolicy:
        "ביטול עד 48 שעות מראש ללא עלות. אי-הגעה או ביטול מאוחר עלולים להיות כרוכים בדמי ביטול.",
      referralText: "",
      remindersEnabled: true,
      reviewsEnabled: false,
      digestEnabled: true,
      depositEnabled: true,
      depositAmountIls: 100,
      depositHoldMinutes: 60,
      bookingModel: "slot",
      availabilityInfo: "",
    },
    seedServices: [
      { name: "ייעוץ ראשוני", durationMin: 30, priceCents: 30000, color: "#3b82f6" },
      { name: "בדיקה", durationMin: 20, priceCents: 25000, color: "#22c55e" },
      { name: "טיפול המשך", durationMin: 45, priceCents: 40000, color: "#6366f1" },
    ],
    // Clinics keep office hours and generally don't open Friday at all.
    seedHours: [
      { dayOfWeek: 0, openMin: 480, closeMin: 1020 },
      { dayOfWeek: 1, openMin: 480, closeMin: 1020 },
      { dayOfWeek: 2, openMin: 480, closeMin: 1020 },
      { dayOfWeek: 3, openMin: 480, closeMin: 1020 },
      { dayOfWeek: 4, openMin: 480, closeMin: 1020 },
    ],
    vocabulary: { customer: "מטופל", customerPlural: "מטופלים", staff: "רופא", service: "בדיקה" },
  },

  aesthetics: {
    type: "aesthetics",
    emoji: "✨",
    labelHe: "קוסמטיקה ואסתטיקה",
    labelEn: "Aesthetics",
    descriptionHe: "טיפולי פנים, לייזר וקוסמטיקה. טון מלוטש ואכפתי, תזכורות עם הנחיות הכנה ומקדמה קטנה.",
    descriptionEn: "Facials, laser and cosmetics. A polished, attentive tone, reminders with preparation instructions, and a small deposit.",
    presets: {
      botPersonality:
        "דבר בטון מלוטש, אכפתי ומרגיע. הדגש תוצאה ופינוק, והקפד על מקצועיות. במידת הצורך ציין הנחיות הכנה לטיפול.",
      cancellationPolicy: "ניתן לבטל או לשנות תור עד 48 שעות מראש. ביטול מאוחר יותר עלול להיות כרוך בדמי ביטול.",
      referralText: "אהבת את התוצאה? הזמיני חברה וקבלו שתיכן הנחה על הטיפול הבא ✨",
      remindersEnabled: true,
      reviewsEnabled: true,
      digestEnabled: true,
      depositEnabled: true,
      depositAmountIls: 50,
      depositHoldMinutes: 45,
      bookingModel: "slot",
      availabilityInfo: "",
    },
    seedServices: [
      { name: "ניקוי פנים", durationMin: 60, priceCents: 28000, color: "#f472b6" },
      { name: "טיפול לייזר", durationMin: 30, priceCents: 35000, color: "#a855f7" },
      { name: "מניקור/פדיקור", durationMin: 45, priceCents: 12000, color: "#fb7185" },
    ],
    seedHours: [
      { dayOfWeek: 0, openMin: 600, closeMin: 1140 },
      { dayOfWeek: 1, openMin: 600, closeMin: 1140 },
      { dayOfWeek: 2, openMin: 600, closeMin: 1140 },
      { dayOfWeek: 3, openMin: 600, closeMin: 1140 },
      { dayOfWeek: 4, openMin: 600, closeMin: 1140 },
      { dayOfWeek: 5, openMin: 540, closeMin: 780 },
    ],
    vocabulary: { customer: "לקוחה", customerPlural: "לקוחות", staff: "קוסמטיקאית", service: "טיפול" },
  },

  bnb: {
    type: "bnb",
    emoji: "🏡",
    labelHe: "צימרים / אירוח",
    labelEn: "B&B / Vacation Rental",
    descriptionHe: "אירוח ולינה. הבוט מוסר מחירים וזמינות כללית, וכשאורח רוצה להזמין — שולח לך התראה עם המספר לחזור אליו (ללא קביעת הזמנה אוטומטית).",
    descriptionEn: "Lodging and hospitality. The bot quotes prices and general availability; when a guest wants to book it alerts you with their number to call back, rather than booking automatically.",
    presets: {
      botPersonality:
        "דבר בטון חם, מסביר פנים ואירוחי. גרום לאורח להרגיש רצוי. מסור מידע על היחידות והמחירים, וכשמבקשים להזמין — אסוף פרטים והעבר למארח.",
      cancellationPolicy: "מדיניות הביטול נמסרת על ידי המארח בעת אישור ההזמנה.",
      referralText: "",
      remindersEnabled: false,
      reviewsEnabled: false,
      digestEnabled: true,
      depositEnabled: false,
      depositAmountIls: 0,
      depositHoldMinutes: 30,
      bookingModel: "inquiry",
      availabilityInfo: "הזמינות משתנה — מומלץ להזמין מראש. סופי שבוע וחגים נתפסים מהר. המארח ימסור זמינות מדויקת בשיחה.",
    },
    seedServices: [
      { name: "לילה — יחידה זוגית", durationMin: 1440, priceCents: 90000, color: "#0ea5e9" },
      { name: "לילה — יחידה משפחתית", durationMin: 1440, priceCents: 130000, color: "#22c55e" },
      { name: "חבילת סוף שבוע (2 לילות)", durationMin: 2880, priceCents: 170000, color: "#f59e0b" },
    ],
    // Inquiry mode — the bot never books a slot, so there are no hours to constrain.
    seedHours: [],
    vocabulary: { customer: "אורח", customerPlural: "אורחים", staff: "המארח", service: "יחידת אירוח" },
  },
};

export function listTemplates(): BusinessTemplate[] {
  return BUSINESS_TYPES.map((t) => TEMPLATES[t]);
}
