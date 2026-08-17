import { describe, it, expect } from "vitest";
import { buildServiceDetailsMessage, normalizeDescription } from "./serviceDetailsMessage.js";

// The real description from the live B&B, which is what produced the wall of text.
const REAL = `צימר משפחתי יחידה ברמה גבוהה, ממוזגת, נקייה ומרווחת. מתאימה לאירוח של 7 אורחים, נמצאת בגובה עם מרפסת נוף. • 3 חדרי שינה: חדר הורים עם דלת מקשרת לחדר נוסף ועוד חדר עם 3 מיטות. • שירותים ומקלחת אחת. • מטבח מאובזר לשבת: פלטה, מיחם, כירה חשמלית, מקרר גדול. • פינת קפה.`;

describe("normalizeDescription", () => {
  it("puts inline bullets on their own lines", () => {
    const out = normalizeDescription(REAL);
    const bulletLines = out.split("\n").filter((l) => l.startsWith("• "));
    expect(bulletLines).toHaveLength(4);
    // The prose before the first bullet stays one line rather than being split mid-sentence.
    expect(out.split("\n")[0]).toContain("מרפסת נוף.");
  });

  it("does not glue a bullet onto the end of the previous sentence", () => {
    expect(normalizeDescription("טקסט. • פריט")).toBe("טקסט.\n• פריט");
  });

  it("leaves a description with no bullets alone", () => {
    expect(normalizeDescription("  צימר זוגי נעים.  ")).toBe("צימר זוגי נעים.");
  });

  it("collapses pasted blank-line runs but keeps a deliberate paragraph break", () => {
    expect(normalizeDescription("א\n\n\n\nב")).toBe("א\n\nב");
    expect(normalizeDescription("א\n\nב")).toBe("א\n\nב");
  });
});

describe("buildServiceDetailsMessage", () => {
  const base = { name: "גפן", description: REAL, priceCents: 210000, maxGuests: 7, linkUrl: null };

  it("bolds the unit name and the price, the two things a reader scans for", () => {
    const out = buildServiceDetailsMessage(base, 'צימר "בנחת רוח"');
    expect(out.startsWith('*גפן* — צימר "בנחת רוח"')).toBe(true);
    expect(out).toContain('*מחיר: 2100 ש"ח ללילה*');
  });

  it("separates sections with a blank line, so it does not read as one paragraph", () => {
    const out = buildServiceDetailsMessage(base, "עסק");
    // header ¶ description ¶ facts
    expect(out.split("\n\n").length).toBeGreaterThanOrEqual(3);
  });

  it("keeps price and capacity together, on adjacent lines", () => {
    const out = buildServiceDetailsMessage(base, "עסק");
    expect(out).toContain('*מחיר: 2100 ש"ח ללילה*\nעד 7 אורחים');
  });

  it("omits every section the service has no value for", () => {
    const out = buildServiceDetailsMessage({ name: "חיטה" }, "עסק");
    expect(out).toBe("*חיטה* — עסק");
  });

  it("labels the extra-details field neutrally, since owners put prose there as often as a URL", () => {
    const prose = buildServiceDetailsMessage({ ...base, linkUrl: 'סופ"ש או 2 לילות, 3400ש"ח' }, "עסק");
    expect(prose).toContain('פרטים נוספים: סופ"ש או 2 לילות, 3400ש"ח');
    const url = buildServiceDetailsMessage({ ...base, linkUrl: "https://example.com" }, "עסק");
    expect(url).toContain("פרטים נוספים: https://example.com");
  });

  it("uses WhatsApp's single-asterisk bold, never Markdown's double", () => {
    expect(buildServiceDetailsMessage(base, "עסק")).not.toContain("**");
  });
});

describe("the rules that qualify a price", () => {
  const unit = { name: "גפן", description: "יחידה משפחתית", priceCents: 210000, maxGuests: 7, linkUrl: null };
  const RULES = {
    pricingNotes: "המחירים לא כוללים ראש השנה ולג בעומר.",
    cancellationPolicy: "מדיניות הביטול נמסרת על ידי המארח בעת אישור ההזמנה.",
  };

  // A price quoted without its exclusions is what a guest books on, and the owner is the one who
  // has to correct it at check-in.
  it("puts the exclusions in the same message as the price", () => {
    const out = buildServiceDetailsMessage(unit, "עסק", RULES);
    expect(out).toContain('*מחיר: 2100 ש"ח ללילה*');
    expect(out).toContain("לא כוללים ראש השנה");
  });

  it("carries the cancellation terms too, while they can still affect a decision", () => {
    expect(buildServiceDetailsMessage(unit, "עסק", RULES)).toContain("ביטולים: מדיניות הביטול נמסרת");
  });

  // Nothing to qualify: rules attached to a unit with no price are noise on a message about photos.
  it("says nothing about pricing rules when there is no price", () => {
    const out = buildServiceDetailsMessage({ name: "גפן" }, "עסק", RULES);
    expect(out).not.toContain("ראש השנה");
    expect(out).not.toContain("ביטולים");
  });

  it("is unchanged for a business that set no rules", () => {
    expect(buildServiceDetailsMessage(unit, "עסק")).toBe(buildServiceDetailsMessage(unit, "עסק", {}));
  });

  it("ignores a field the owner left as whitespace", () => {
    const out = buildServiceDetailsMessage(unit, "עסק", { pricingNotes: "   ", cancellationPolicy: null });
    expect(out).toBe(buildServiceDetailsMessage(unit, "עסק"));
  });
});
