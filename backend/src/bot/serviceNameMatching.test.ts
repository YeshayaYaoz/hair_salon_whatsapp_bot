import { describe, it, expect, vi } from "vitest";

// claudeBot pulls in prisma and the provider SDKs through its module graph; the normalizer under
// test is pure, so stub the heavy dependencies rather than standing them up.
vi.mock("../lib/prisma.js", () => ({ prisma: {} }));

const { normalizeServiceName } = await import("./claudeBot.js");

/**
 * Regression tests for a live outage: a B&B named its units `צימר "תאנה"` and
 * `"תמר" - יחידה משפחתית`, while both customers and the model refer to them as "תאנה" / "תמר".
 * Exact-name matching rejected every one of those as "Unknown service", so no tool call on a
 * real unit could ever succeed.
 */
describe("normalizeServiceName", () => {
  it("strips the quote styles owners actually type", () => {
    expect(normalizeServiceName('צימר "תאנה"')).toBe("צימר תאנה");
    expect(normalizeServiceName("צימר ״תאנה״")).toBe("צימר תאנה");
    expect(normalizeServiceName("'תמר' - יחידה משפחתית")).toBe("תמר יחידה משפחתית");
  });

  it("collapses whitespace so spacing differences don't matter", () => {
    expect(normalizeServiceName("  תספורת   גברים ")).toBe("תספורת גברים");
  });

  it("lets the bare unit name match the decorated stored name by containment", () => {
    const stored = normalizeServiceName('צימר "תאנה"');
    expect(stored.includes(normalizeServiceName("תאנה"))).toBe(true);
    expect(normalizeServiceName('"תמר" - יחידה משפחתית').includes(normalizeServiceName("תמר"))).toBe(true);
  });

  it("does not make distinct units collide", () => {
    const tea = normalizeServiceName('צימר "תאנה"');
    const wheat = normalizeServiceName('צימר "חיטה"');
    expect(tea).not.toBe(wheat);
    expect(tea.includes(normalizeServiceName("חיטה"))).toBe(false);
  });

  it("is case-insensitive for Latin-script names", () => {
    expect(normalizeServiceName("Deluxe Suite")).toBe(normalizeServiceName("deluxe   suite"));
  });
});
