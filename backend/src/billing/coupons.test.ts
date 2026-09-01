import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  coupon: { findUnique: vi.fn(), updateMany: vi.fn() },
  couponRedemption: { create: vi.fn() },
  business: { update: vi.fn() },
  $transaction: vi.fn(),
};
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

const {
  validateCoupon,
  redeemCoupon,
  discountFor,
  couponDiscountForCharge,
  couponStateAfterCharge,
  normalizeCode,
  CouponError,
} = await import("./coupons.js");
const { PLAN_PRICES_ILS } = await import("./payplusSubscription.js");

/** Half of premium, to whole shekels — the discount LAUNCH50 works out to at current prices. */
const HALF_PREMIUM = Math.round(PLAN_PRICES_ILS.premium / 2);

function coupon(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    code: "LAUNCH50",
    discountType: "percent",
    discountValue: 50,
    durationCycles: 3,
    maxRedemptions: null,
    redeemedCount: 0,
    expiresAt: null,
    active: true,
    allowedPlans: [],
    redemptions: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The real $transaction hands the callback a client; the mock hands it the same mock.
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma));
  mockPrisma.coupon.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.couponRedemption.create.mockResolvedValue({});
  mockPrisma.business.update.mockResolvedValue({});
});

describe("discountFor", () => {
  it("computes a percentage against the plan's own price", () => {
    // Derived from the price table rather than restated, so a price change moves the expectation
    // with it instead of failing here for no behavioural reason.
    expect(discountFor({ discountType: "percent", discountValue: 50 }, "standard")).toBe(
      Math.round(PLAN_PRICES_ILS.standard / 2)
    );
    expect(discountFor({ discountType: "percent", discountValue: 50 }, "premium")).toBe(
      Math.round(PLAN_PRICES_ILS.premium / 2)
    );
  });

  it("caps a discount at the plan price instead of going negative", () => {
    // PayPlus rejects a non-positive amount with an error that says nothing about coupons.
    // Whole shekels: couponDiscountIls is an Int column, so a cap of 174.9 threw on write and the
    // redemption failed after the customer had already paid.
    expect(discountFor({ discountType: "fixed", discountValue: 9999 }, "standard")).toBe(
      Math.floor(PLAN_PRICES_ILS.standard)
    );
    expect(discountFor({ discountType: "percent", discountValue: 100 }, "premium")).toBe(
      Math.floor(PLAN_PRICES_ILS.premium)
    );
    for (const plan of Object.keys(PLAN_PRICES_ILS)) {
      const capped = discountFor({ discountType: "fixed", discountValue: 9999 }, plan);
      expect(Number.isInteger(capped)).toBe(true);
      expect(capped).toBeLessThanOrEqual(PLAN_PRICES_ILS[plan]);
    }
  });

  it("is zero for an unknown plan rather than NaN", () => {
    expect(discountFor({ discountType: "percent", discountValue: 50 }, "nonsense")).toBe(0);
  });
});

describe("normalizeCode", () => {
  it("uppercases and trims, so the stored form is canonical", () => {
    expect(normalizeCode("  launch50 ")).toBe("LAUNCH50");
  });
});

describe("validateCoupon", () => {
  it("returns the discount for a good code", async () => {
    mockPrisma.coupon.findUnique.mockResolvedValue(coupon());
    const preview = await validateCoupon("launch50", "premium", "b1");
    expect(preview).toMatchObject({ code: "LAUNCH50", discountIls: HALF_PREMIUM, durationCycles: 3 });
  });

  it.each([
    ["not_found", null],
    ["inactive", coupon({ active: false })],
    ["expired", coupon({ expiresAt: new Date(Date.now() - 1000) })],
    ["exhausted", coupon({ maxRedemptions: 5, redeemedCount: 5 })],
    ["wrong_plan", coupon({ allowedPlans: ["ultra"] })],
    ["already_used", coupon({ redemptions: [{ id: "r1" }] })],
  ])("rejects with %s", async (reason, row) => {
    mockPrisma.coupon.findUnique.mockResolvedValue(row);
    await expect(validateCoupon("LAUNCH50", "premium", "b1")).rejects.toMatchObject({ reason });
  });

  it("consumes nothing", async () => {
    mockPrisma.coupon.findUnique.mockResolvedValue(coupon());
    await validateCoupon("LAUNCH50", "premium", "b1");
    expect(mockPrisma.coupon.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.couponRedemption.create).not.toHaveBeenCalled();
  });
});

describe("redeemCoupon", () => {
  it("records the redemption and writes the discount onto the business", async () => {
    mockPrisma.coupon.findUnique.mockResolvedValue(coupon());

    const result = await redeemCoupon("LAUNCH50", "premium", "b1");

    expect(result).toEqual({ applied: true, discountIls: HALF_PREMIUM });
    expect(mockPrisma.couponRedemption.create).toHaveBeenCalledWith({
      data: { couponId: "c1", businessId: "b1", discountIls: HALF_PREMIUM, plan: "premium" },
    });
    expect(mockPrisma.business.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { couponCode: "LAUNCH50", couponDiscountIls: HALF_PREMIUM, couponCyclesRemaining: 3 },
    });
  });

  it("guards the redemption cap inside the claim, so a race cannot overshoot it", async () => {
    mockPrisma.coupon.findUnique.mockResolvedValue(coupon({ maxRedemptions: 10, redeemedCount: 9 }));

    await redeemCoupon("LAUNCH50", "premium", "b1");

    const claim = mockPrisma.coupon.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: "c1", active: true, redeemedCount: { lt: 10 } });
  });

  it("reports exhausted when the claim loses the race", async () => {
    mockPrisma.coupon.findUnique.mockResolvedValue(coupon({ maxRedemptions: 1, redeemedCount: 0 }));
    mockPrisma.coupon.updateMany.mockResolvedValue({ count: 0 });

    const result = await redeemCoupon("LAUNCH50", "premium", "b1");

    expect(result).toMatchObject({ applied: false, reason: "exhausted" });
    expect(mockPrisma.couponRedemption.create).not.toHaveBeenCalled();
  });

  it("never throws at the caller — a failed redemption must not undo a completed payment", async () => {
    mockPrisma.coupon.findUnique.mockResolvedValue(coupon());
    // What a duplicate webhook delivery looks like: the unique constraint rejects the second.
    mockPrisma.couponRedemption.create.mockRejectedValue(new Error("unique constraint failed"));

    const result = await redeemCoupon("LAUNCH50", "premium", "b1");

    expect(result).toMatchObject({ applied: false, reason: "already_used" });
  });
});

describe("couponDiscountForCharge", () => {
  it("applies while cycles remain", () => {
    expect(couponDiscountForCharge({ couponDiscountIls: 87, couponCyclesRemaining: 2 })).toBe(87);
  });

  it("stops once the cycles run out", () => {
    expect(couponDiscountForCharge({ couponDiscountIls: 87, couponCyclesRemaining: 0 })).toBe(0);
  });

  it("never stops when the coupon has no duration", () => {
    expect(couponDiscountForCharge({ couponDiscountIls: 87, couponCyclesRemaining: null })).toBe(87);
  });

  it("is zero with no coupon", () => {
    expect(couponDiscountForCharge({ couponDiscountIls: 0, couponCyclesRemaining: null })).toBe(0);
  });
});

describe("couponStateAfterCharge", () => {
  it("counts a cycle down", () => {
    expect(couponStateAfterCharge({ couponDiscountIls: 87, couponCyclesRemaining: 3 })).toEqual({
      couponCyclesRemaining: 2,
    });
  });

  it("clears the discount as well as the counter on the last cycle", () => {
    // One representation of "no coupon" — a lingering discount that is only inert because a second
    // field says so is the kind of state that gets read wrong later.
    expect(couponStateAfterCharge({ couponDiscountIls: 87, couponCyclesRemaining: 1 })).toEqual({
      couponDiscountIls: 0,
      couponCyclesRemaining: 0,
    });
  });

  it("leaves a forever-coupon alone", () => {
    expect(couponStateAfterCharge({ couponDiscountIls: 87, couponCyclesRemaining: null })).toEqual({});
  });
});
