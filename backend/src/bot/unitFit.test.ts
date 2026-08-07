import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Which unit holds a given party, decided in code.
 *
 * Two real conversations got this wrong while the rule lived only in the prompt: a family of five
 * was steered to the ₪3,000 ten-guest unit while the ₪2,100 seven-guest one went unmentioned, and a
 * party of six was offered a unit that sleeps three. Neither is catchable downstream — the unit is
 * real and the price is right, so the reply looks entirely normal.
 */
describe("find_units_for_guests", () => {
  const units = [
    { name: "חיטה", priceCents: 80000, maxGuests: 2 },
    { name: "תאנה", priceCents: 100000, maxGuests: 3 },
    { name: "גפן", priceCents: 210000, maxGuests: 7 },
    { name: "תמר", priceCents: 300000, maxGuests: 10 },
  ];
  let findMany: ReturnType<typeof vi.fn>;

  async function call(guestCount: unknown, rows = units) {
    vi.resetModules();
    findMany = vi.fn(async () => [...rows].sort((a, b) => a.priceCents - b.priceCents));
    vi.doMock("../lib/prisma.js", () => ({ prisma: { service: { findMany } } }));
    vi.doMock("../lib/depositExpiryJob.js", () => ({ noteDepositHoldCreated: vi.fn() }));
    const { runTool } = await import("./claudeBot.js");
    return JSON.parse(await runTool("biz1", "972500000000", "find_units_for_guests", { guestCount }, {}, {}));
  }

  beforeEach(() => vi.clearAllMocks());

  it("offers the cheapest unit that actually fits", async () => {
    // The first bug: five people were sent to תמר at ₪3,000 with גפן at ₪2,100 never mentioned.
    const out = await call(5);
    expect(out.recommended).toEqual({ name: "גפן", priceIls: 2100 });
    expect(out.alsoFit).toEqual([{ name: "תמר", priceIls: 3000 }]);
  });

  it("never returns a unit too small for the party", async () => {
    // The second bug: six people (2 adults, 3 children, a baby) were offered תאנה, which sleeps 3.
    const out = await call(6);
    expect(out.recommended.name).toBe("גפן");
    expect(out.tooSmall).toEqual(expect.arrayContaining(["חיטה", "תאנה"]));
    expect([out.recommended, ...out.alsoFit].map((u: { name: string }) => u.name)).not.toContain("תאנה");
  });

  it("counts a party that exactly fills a unit as fitting", async () => {
    expect((await call(7)).recommended.name).toBe("גפן");
  });

  it("says plainly when nothing is big enough", async () => {
    const out = await call(12);
    expect(out.recommended).toBeNull();
    expect(out.alsoFit).toEqual([]);
    expect(out.note).toMatch(/No unit fits/);
  });

  it("treats a unit with no stated capacity as unknown, not as excluded", async () => {
    // Blank means the owner hasn't said. Ruling it out would hide a unit that may well fit, and
    // ruling it in would invent a number they never gave.
    const out = await call(6, [
      { name: "חיטה", priceCents: 80000, maxGuests: 2 },
      { name: "אלון", priceCents: 250000, maxGuests: null as unknown as number },
    ]);
    expect(out.recommended).toBeNull();
    expect(out.capacityUnknown).toEqual(["אלון"]);
    expect(out.tooSmall).toEqual(["חיטה"]);
    expect(out.note).toMatch(/capacityUnknown/);
  });

  it("rejects a headcount that is not a positive number", async () => {
    expect((await call(0)).error).toBeTruthy();
    expect((await call(-3)).error).toBeTruthy();
    expect((await call("שלושה")).error).toBeTruthy();
  });
});
