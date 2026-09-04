import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const mockPrisma = {
  business: { update: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  systemSetting: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
};
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/crypto.js", () => ({ encryptSecret: (v: string) => `enc:${v}`, decryptSecret: (v: string) => v }));
vi.mock("../lib/errorMonitoring.js", () => ({ captureError: vi.fn() }));
vi.mock("../lib/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.businessId = "biz1";
    next();
  },
}));

const chargeSubscriptionToken = vi.fn();
const createSubscriptionCheckoutLink = vi.fn();
vi.mock("./payplusSubscription.js", async () => {
  const actual = await vi.importActual<typeof import("./payplusSubscription.js")>("./payplusSubscription.js");
  return {
    ...actual,
    chargeSubscriptionToken: (...a: unknown[]) => chargeSubscriptionToken(...a),
    createSubscriptionCheckoutLink: (...a: unknown[]) => createSubscriptionCheckoutLink(...a),
  };
});

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Changing plan is the only action in the dashboard that takes money from a saved card the instant
 * it is clicked — no payment page, no PayPlus email first, nothing to abandon. What it charges is
 * therefore worth pinning precisely.
 */
describe("changing plan mid-period", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.PAYPLUS_BILLING_WEBHOOK_SECRET = "s".repeat(20);
    const { payplusBillingRouter } = await import("./payplusBillingRoutes.js");
    app = express();
    app.use(express.json());
    app.use("/api/billing", payplusBillingRouter);
    mockPrisma.business.update.mockResolvedValue({});
    chargeSubscriptionToken.mockResolvedValue({ success: true });
  });

  const subscriber = (overrides: Record<string, unknown> = {}) => ({
    id: "biz1",
    subscriptionPlan: "premium",
    subscriptionToken: "tok",
    subscriptionCustomerUid: "cus",
    billingCycle: "monthly",
    nextBillingDate: new Date(Date.now() + 30 * DAY_MS),
    ...overrides,
  });

  const put = (plan: string) => request(app).put("/api/billing/payplus/plan").send({ plan });
  /** The amount that actually reached the card. */
  const charged = () => chargeSubscriptionToken.mock.calls.at(-1)![1] as number;

  it("charges the difference in daily rates for the days left", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(subscriber());

    const res = await put("ultra");

    // (749.90 − 374.90) / 30 × 30 days ≈ the full monthly difference.
    expect(charged()).toBeCloseTo(375, 0);
    expect(res.body.proratedChargeIls).toBeCloseTo(375, 0);
  });

  it("charges about half of that with half the period gone", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      subscriber({ nextBillingDate: new Date(Date.now() + 15 * DAY_MS) })
    );

    await put("ultra");

    expect(charged()).toBeCloseTo(188, -1);
  });

  /**
   * The bug this file was written for.
   *
   * The daily rate came from the monthly list price over 30, while the days came from the real
   * cycle — 365 of them on an annual term. An annual Premium subscriber upgrading to Ultra with a
   * year to run was charged (749.90 − 374.90)/30 × 365 = ₪4,562.50, against a true annual
   * difference of (7,499 − 3,749) = ₪3,750: ₪812.50 too much, taken instantly, from the customers
   * who had paid furthest ahead.
   */
  it("prices an annual upgrade off the annual price, not the monthly one", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      subscriber({ billingCycle: "annual", nextBillingDate: new Date(Date.now() + 365 * DAY_MS) })
    );

    await put("ultra");

    // Ten months charged per annual term, so the difference is (749.90 − 374.90) × 10.
    expect(charged()).toBeCloseTo(3750, -1);
    expect(charged()).toBeLessThan(4000);
  });

  it("charges an annual subscriber proportionally when part of the year is gone", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      subscriber({ billingCycle: "annual", nextBillingDate: new Date(Date.now() + 73 * DAY_MS) })
    );

    await put("ultra");

    // A fifth of the year left, so a fifth of the annual difference.
    expect(charged()).toBeCloseTo(750, -2);
  });

  it("takes nothing for a downgrade", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(subscriber());

    const res = await put("standard");

    expect(chargeSubscriptionToken).not.toHaveBeenCalled();
    expect(res.body.proratedChargeIls).toBe(0);
    expect(mockPrisma.business.update.mock.calls.at(-1)![0].data.subscriptionPlan).toBe("standard");
  });

  it("charges nothing when the period has already run out", async () => {
    // The nightly job is about to bill a full period at the new price; charging for days that no
    // longer exist would bill the same time twice.
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      subscriber({ nextBillingDate: new Date(Date.now() - 3 * DAY_MS) })
    );

    await put("ultra");

    expect(chargeSubscriptionToken).not.toHaveBeenCalled();
  });

  it("does not move the plan when the charge is declined", async () => {
    // Otherwise a declined card buys the upgrade anyway — the plan changes, the money does not,
    // and the nightly job then renews at the higher price it was never paid for.
    chargeSubscriptionToken.mockResolvedValue({ success: false, error: "declined" });
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(subscriber());

    const res = await put("ultra");

    expect(res.status).toBe(502);
    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });

  it("charges nothing at all when the plan is already the one asked for", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(subscriber());

    const res = await put("premium");

    expect(res.body).toEqual({ ok: true });
    expect(chargeSubscriptionToken).not.toHaveBeenCalled();
    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });

  it("sends a business with no saved card to a payment page instead of charging", async () => {
    createSubscriptionCheckoutLink.mockResolvedValue("https://pay.example/abc");
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(subscriber({ subscriptionToken: null }));

    const res = await put("ultra");

    expect(res.body.url).toBe("https://pay.example/abc");
    expect(chargeSubscriptionToken).not.toHaveBeenCalled();
    // And the plan does not move until that page is actually paid.
    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });
});
