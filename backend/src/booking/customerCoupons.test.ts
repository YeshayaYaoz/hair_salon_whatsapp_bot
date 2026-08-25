import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  customerCoupon: { findUnique: vi.fn(), updateMany: vi.fn() },
  customerCouponRedemption: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
  $transaction: vi.fn(),
};
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

const {
  quoteCustomerCoupon,
  redeemCustomerCoupon,
  releaseCustomerCoupon,
  discountForPrice,
  normalizeCustomerCode,
} = await import("./customerCoupons.js");

function coupon(overrides: Record<string, unknown> = {}) {
  return {
    id: "cc1",
    businessId: "b1",
    code: "WELCOME10",
    discountType: "percent",
    discountValue: 10,
    serviceIds: [],
    maxUses: null,
    usedCount: 0,
    onePerCustomer: true,
    expiresAt: null,
    active: true,
    description: "10% ללקוחות חדשים",
    ...overrides,
  };
}

const quoteArgs = {
  businessId: "b1",
  code: "welcome10",
  serviceId: "s1",
  servicePriceIls: 200,
  customerPhone: "972501234567",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.customerCoupon.findUnique.mockResolvedValue(coupon());
  mockPrisma.customerCouponRedemption.findFirst.mockResolvedValue(null);
  mockPrisma.customerCoupon.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.customerCouponRedemption.create.mockResolvedValue({});
  mockPrisma.$transaction.mockResolvedValue([]);
});

describe("discountForPrice", () => {
  it("takes a percentage off the service price", () => {
    expect(discountForPrice({ discountType: "percent", discountValue: 25 }, 200)).toBe(50);
  });

  it("never exceeds the price — a big code is a free service, not a refund", () => {
    expect(discountForPrice({ discountType: "fixed", discountValue: 500 }, 200)).toBe(200);
  });
});

describe("normalizeCustomerCode", () => {
  it("uppercases and trims", () => {
    expect(normalizeCustomerCode(" welcome10 ")).toBe("WELCOME10");
  });
});

describe("quoteCustomerCoupon", () => {
  it("quotes the discount and the final price", async () => {
    const quote = await quoteCustomerCoupon(quoteArgs);
    expect(quote).toMatchObject({ code: "WELCOME10", discountIls: 20, finalPriceIls: 180 });
  });

  it("looks the code up scoped to the business", async () => {
    // Two salons may both run WELCOME10 and neither should see the other's.
    await quoteCustomerCoupon(quoteArgs);
    expect(mockPrisma.customerCoupon.findUnique).toHaveBeenCalledWith({
      where: { businessId_code: { businessId: "b1", code: "WELCOME10" } },
    });
  });

  it.each([
    ["not_found", null],
    ["inactive", coupon({ active: false })],
    ["expired", coupon({ expiresAt: new Date(Date.now() - 1000) })],
    ["exhausted", coupon({ maxUses: 3, usedCount: 3 })],
    ["wrong_service", coupon({ serviceIds: ["other"] })],
  ])("refuses with %s", async (reason, row) => {
    mockPrisma.customerCoupon.findUnique.mockResolvedValue(row);
    await expect(quoteCustomerCoupon(quoteArgs)).rejects.toMatchObject({ reason });
  });

  it("refuses a repeat use when the coupon is one-per-customer", async () => {
    mockPrisma.customerCouponRedemption.findFirst.mockResolvedValue({ id: "r1" });
    await expect(quoteCustomerCoupon(quoteArgs)).rejects.toMatchObject({ reason: "already_used" });
  });

  it("matches a returning customer whatever format their number is written in", async () => {
    await quoteCustomerCoupon({ ...quoteArgs, customerPhone: "+972-50-123-4567" });
    expect(mockPrisma.customerCouponRedemption.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { couponId: "cc1", customerPhone: "972501234567" } })
    );
  });

  it("allows a repeat use when the coupon is not one-per-customer", async () => {
    mockPrisma.customerCoupon.findUnique.mockResolvedValue(coupon({ onePerCustomer: false }));
    mockPrisma.customerCouponRedemption.findFirst.mockResolvedValue({ id: "r1" });
    await expect(quoteCustomerCoupon(quoteArgs)).resolves.toMatchObject({ discountIls: 20 });
  });

  it("consumes nothing — a customer may ask about a code repeatedly", async () => {
    await quoteCustomerCoupon(quoteArgs);
    await quoteCustomerCoupon(quoteArgs);
    expect(mockPrisma.customerCoupon.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.customerCouponRedemption.create).not.toHaveBeenCalled();
  });
});

describe("redeemCustomerCoupon", () => {
  const redeemArgs = { couponId: "cc1", customerPhone: "972501234567", appointmentId: "a1", discountIls: 20 };

  it("claims a use and records it against the appointment", async () => {
    mockPrisma.customerCoupon.findUnique.mockResolvedValue({ maxUses: null });

    await expect(redeemCustomerCoupon(redeemArgs)).resolves.toBe(true);

    expect(mockPrisma.customerCouponRedemption.create).toHaveBeenCalledWith({
      data: { couponId: "cc1", customerPhone: "972501234567", appointmentId: "a1", discountIls: 20 },
    });
  });

  it("guards the cap inside the claim, so two customers cannot take the same last use", async () => {
    mockPrisma.customerCoupon.findUnique.mockResolvedValue({ maxUses: 5 });

    await redeemCustomerCoupon(redeemArgs);

    expect(mockPrisma.customerCoupon.updateMany.mock.calls[0][0].where).toMatchObject({
      id: "cc1",
      active: true,
      usedCount: { lt: 5 },
    });
  });

  it("returns false instead of throwing when the use is gone", async () => {
    // The customer already has a confirmed booking by this point — failing it over a promotion
    // counter would be the wrong trade.
    mockPrisma.customerCoupon.findUnique.mockResolvedValue({ maxUses: 1 });
    mockPrisma.customerCoupon.updateMany.mockResolvedValue({ count: 0 });

    await expect(redeemCustomerCoupon(redeemArgs)).resolves.toBe(false);
    expect(mockPrisma.customerCouponRedemption.create).not.toHaveBeenCalled();
  });
});

describe("releaseCustomerCoupon", () => {
  it("gives the use back when the booking is cancelled", async () => {
    mockPrisma.customerCouponRedemption.findFirst.mockResolvedValue({ id: "r1", couponId: "cc1" });

    await releaseCustomerCoupon("a1");

    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it("does nothing for a booking that used no coupon", async () => {
    mockPrisma.customerCouponRedemption.findFirst.mockResolvedValue(null);

    await releaseCustomerCoupon("a1");

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
