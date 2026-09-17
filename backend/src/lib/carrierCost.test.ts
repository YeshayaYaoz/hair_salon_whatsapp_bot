import { describe, it, expect, vi } from "vitest";

// usageLedger (for USD_TO_ILS) imports the Prisma client at module load; without this the file
// fails before the first test runs, on a database it has no reason to touch.
vi.mock("./prisma.js", () => ({ prisma: {} }));
import { carrierCostAgorotMonth, CARRIER_USD_PER_NUMBER_MONTH } from "./carrierCost.js";
import { USD_TO_ILS } from "./usageLedger.js";

/**
 * The one fixed per-business cost. Derived from the two constants rather than restated, so a
 * price change or a rate change moves the expectation instead of failing here for no reason.
 */
describe("carrierCostAgorotMonth", () => {
  it("is the flat monthly fee, in agorot, at the panel's own dollar rate", () => {
    expect(carrierCostAgorotMonth(true)).toBe(Math.round(CARRIER_USD_PER_NUMBER_MONTH * USD_TO_ILS * 100));
    // Concretely, so a reader knows what a line costs without opening two files: $3 × 3.7 = ₪11.10.
    expect(carrierCostAgorotMonth(true)).toBe(1110);
  });

  it("is zero for a business that has not been issued a number", () => {
    expect(carrierCostAgorotMonth(false)).toBe(0);
  });
});
