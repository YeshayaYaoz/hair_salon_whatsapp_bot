import { describe, it, expect, vi } from "vitest";

// Pure arithmetic under test, but the module reaches Prisma at import time.
vi.mock("../lib/prisma.js", () => ({ prisma: {} }));

import { unusedCreditIls, chargeAfterCredit, MIN_CHARGE_ILS, PLAN_PRICES_ILS, planPriceForCycle } from "./payplusSubscription.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-04T12:00:00Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY);

/**
 * Without this credit, switching to annual on day 3 of a paid month means paying twice for the
 * remaining 27 days. The mid-cycle plan change already worked this way; these lock the same rule
 * into every other upgrade path.
 */
describe("unusedCreditIls", () => {
  const monthly = (nextBillingDate: Date | null, plan = "premium") => ({
    subscriptionPlan: plan,
    billingCycle: "monthly",
    nextBillingDate,
  });

  it("credits the untouched part of a monthly period", () => {
    // 27 of 30 days of the premium month, derived from the price table so a price change moves the
    // expectation instead of failing here for no behavioural reason.
    expect(unusedCreditIls(monthly(inDays(27)), NOW)).toBe(Math.round((PLAN_PRICES_ILS.premium * 27) / 30));
  });

  it("credits nothing on the last day of the period", () => {
    expect(unusedCreditIls(monthly(NOW), NOW)).toBe(0);
  });

  it("credits nothing once the period is already overdue", () => {
    // An overdue business owes us; it must not read as credit.
    expect(unusedCreditIls(monthly(inDays(-10)), NOW)).toBe(0);
  });

  it("caps at one period so a manually pushed date cannot manufacture credit", () => {
    // Rounded: the credit is whole shekels, and the price no longer is.
    expect(unusedCreditIls(monthly(inDays(900)), NOW)).toBe(Math.round(PLAN_PRICES_ILS.premium));
  });

  it("scales with the plan — a standard subscriber gets less back", () => {
    expect(unusedCreditIls(monthly(inDays(15), "standard"), NOW)).toBeLessThan(
      unusedCreditIls(monthly(inDays(15), "premium"), NOW)
    );
  });

  it("uses the annual amount actually paid, not a month's worth", () => {
    const half = unusedCreditIls(
      { subscriptionPlan: "premium", billingCycle: "annual", nextBillingDate: inDays(182) },
      NOW
    );
    // Half a year of the 10-month annual charge — bracketed around that, not a fixed figure.
    const annualHalf = planPriceForCycle("premium", "annual") / 2;
    expect(half).toBeGreaterThan(annualHalf * 0.97);
    expect(half).toBeLessThan(annualHalf * 1.03);
  });

  it("returns 0 with no period end rather than guessing", () => {
    expect(unusedCreditIls(monthly(null), NOW)).toBe(0);
  });

  it("returns 0 for a plan it does not price", () => {
    expect(unusedCreditIls(monthly(inDays(15), "enterprise"), NOW)).toBe(0);
  });
});

describe("chargeAfterCredit", () => {
  it("subtracts the credit", () => {
    expect(chargeAfterCredit(4490, 404)).toBe(4086);
  });

  it("never produces an amount PayPlus would reject", () => {
    // A credit larger than the upgrade is not a reason to fail the upgrade.
    expect(chargeAfterCredit(100, 5000)).toBe(MIN_CHARGE_ILS);
    expect(chargeAfterCredit(100, 100)).toBe(MIN_CHARGE_ILS);
  });

  it("leaves a first purchase at full price — nothing has been paid yet", () => {
    const full = planPriceForCycle("premium", "annual");
    expect(chargeAfterCredit(full, 0)).toBe(full);
  });
});

describe("the annual switch as a whole", () => {
  it("costs less than the list price when a paid month is still running", () => {
    const list = planPriceForCycle("premium", "annual");
    const credit = unusedCreditIls(
      { subscriptionPlan: "premium", billingCycle: "monthly", nextBillingDate: inDays(27) },
      NOW
    );
    expect(chargeAfterCredit(list, credit)).toBeLessThan(list);
    // Still the overwhelming majority of the annual price — the credit is one month at most.
    expect(chargeAfterCredit(list, credit)).toBeGreaterThan(list - PLAN_PRICES_ILS.premium - 1);
  });
});
