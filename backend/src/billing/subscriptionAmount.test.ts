import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({ prisma: {} }));

const { subscriptionChargeIls } = await import("./subscriptionAmount.js");
const { PLAN_PRICES_ILS, MANAGED_PAYMENT_SURCHARGE_ILS, MANAGED_INVOICE_SURCHARGE_ILS, ANNUAL_MONTHS_CHARGED } =
  await import("./payplusSubscription.js");
const { fmtIls } = await import("../lib/money.js");

/**
 * One function, because there used to be two. The nightly charge counted the managed-account
 * surcharges and the coupon; the reminder sent two days earlier counted neither — so the amount a
 * business was told was not the amount taken. These pin the pieces that diverged.
 */
const base = {
  subscriptionPlan: "premium",
  billingCycle: "monthly",
  loyaltyDiscountIls: 0,
  couponDiscountIls: 0,
  couponCyclesRemaining: null,
  paymentProvider: null,
  invoiceProvider: null,
};

describe("subscriptionChargeIls", () => {
  it("is the plan price for a plain monthly subscriber", () => {
    expect(subscriptionChargeIls(base)).toBe(PLAN_PRICES_ILS.premium);
  });

  it("charges ten months on an annual term, not twelve", () => {
    expect(subscriptionChargeIls({ ...base, billingCycle: "annual" })).toBe(
      PLAN_PRICES_ILS.premium * ANNUAL_MONTHS_CHARGED
    );
  });

  it("adds the managed-account surcharges — the reminder used to leave these out", () => {
    expect(subscriptionChargeIls({ ...base, paymentProvider: "tori_managed", invoiceProvider: "tori_managed" })).toBe(
      PLAN_PRICES_ILS.premium + MANAGED_PAYMENT_SURCHARGE_ILS + MANAGED_INVOICE_SURCHARGE_ILS
    );
  });

  it("applies a live coupon — the reminder used to leave this out too", () => {
    expect(subscriptionChargeIls({ ...base, couponDiscountIls: 100, couponCyclesRemaining: 2 })).toBe(
      PLAN_PRICES_ILS.premium - 100
    );
  });

  it("ignores a coupon whose cycles are spent", () => {
    expect(subscriptionChargeIls({ ...base, couponDiscountIls: 100, couponCyclesRemaining: 0 })).toBe(
      PLAN_PRICES_ILS.premium
    );
  });

  it("never returns an amount PayPlus would reject", () => {
    expect(subscriptionChargeIls({ ...base, couponDiscountIls: 9999, couponCyclesRemaining: null })).toBe(1);
  });

  it("returns null for a plan it cannot price, so callers skip rather than invent a charge", () => {
    expect(subscriptionChargeIls({ ...base, subscriptionPlan: "enterprise" })).toBeNull();
    expect(subscriptionChargeIls({ ...base, subscriptionPlan: null })).toBeNull();
  });

  it("returns real money, never a floating-point artefact", () => {
    // ₪174.90 less a ₪111 coupon is 63.900000000000006 before rounding — the shape of number that
    // was reaching both the customer's WhatsApp and PayPlus itself.
    const amount = subscriptionChargeIls({
      ...base,
      subscriptionPlan: "standard",
      couponDiscountIls: 111,
      couponCyclesRemaining: 1,
    })!;
    expect(amount).toBe(63.9);
    expect(fmtIls(amount)).toBe("63.90");
  });
});

describe("fmtIls", () => {
  it("keeps whole shekels clean and gives part-shekels both digits", () => {
    expect(fmtIls(3749)).toBe("3749");
    expect(fmtIls(374.9)).toBe("374.90");
    expect(fmtIls(749.8)).toBe("749.80");
  });

  it("rounds float noise away rather than printing it", () => {
    expect(fmtIls(374.9 * 12)).toBe("4498.80");
    expect(fmtIls(63.900000000000006)).toBe("63.90");
  });
});
