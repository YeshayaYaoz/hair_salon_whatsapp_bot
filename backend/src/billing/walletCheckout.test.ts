import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const mockPrisma = {
  business: { update: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  // The webhook persists a keys-only diagnostic of every callback for the admin health card.
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

const createSubscriptionCheckoutLink = vi.fn();
const createWalletTopupLink = vi.fn();
const chargeSubscriptionToken = vi.fn();
vi.mock("./payplusSubscription.js", async () => {
  const actual = await vi.importActual<typeof import("./payplusSubscription.js")>("./payplusSubscription.js");
  return {
    ...actual,
    createSubscriptionCheckoutLink: (...a: unknown[]) => createSubscriptionCheckoutLink(...a),
    createWalletTopupLink: (...a: unknown[]) => createWalletTopupLink(...a),
    chargeSubscriptionToken: (...a: unknown[]) => chargeSubscriptionToken(...a),
  };
});

const { PLAN_PRICES_ILS } = await import("./payplusSubscription.js");

/**
 * The bug these cover: "טען יתרה" and "עבור למנוי שנתי" both answered
 * "No active PayPlus subscription" to a business that was visibly active and paying. The cause was
 * a missing card token — which a business can legitimately lack (activated by hand, or activated
 * by a checkout that returned no token), and which the owner can do nothing about from that
 * message. Both now fall back to a hosted payment page.
 */
describe("billing actions without a saved card token", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.PAYPLUS_BILLING_WEBHOOK_SECRET = "s".repeat(20);
    const { payplusBillingRouter } = await import("./payplusBillingRoutes.js");
    app = express();
    app.use(express.json());
    app.use("/api/billing", payplusBillingRouter);
  });

  const noToken = {
    id: "biz1",
    subscriptionPlan: "premium",
    subscriptionToken: null,
    billingCycle: "monthly",
    nextBillingDate: new Date(Date.now() + 10 * 86400_000),
  };

  it("returns a hosted page for a wallet top-up instead of an error", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(noToken);
    createWalletTopupLink.mockResolvedValue("https://payplus.example/pay/abc");

    const res = await request(app).post("/api/billing/payplus/wallet/topup").send({ amountIls: 50 });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://payplus.example/pay/abc");
    expect(createWalletTopupLink).toHaveBeenCalledWith("biz1", 50, expect.any(String));
    // Crucially, no balance was credited — the money hasn't been taken yet.
    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });

  it("returns a hosted page for the annual switch instead of an error", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(noToken);
    createSubscriptionCheckoutLink.mockResolvedValue("https://payplus.example/pay/annual");

    const res = await request(app).post("/api/billing/payplus/switch-to-annual").send({});

    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://payplus.example/pay/annual");
    // Fifth argument is the amount, already reduced by the unused part of the current month: 10 of
    // 30 days of a premium month off the 10-month annual price. Derived from the price table so a
    // price change moves the expectation instead of failing here for no behavioural reason.
    const credit = Math.round((PLAN_PRICES_ILS.premium * 10) / 30);
    const annual = PLAN_PRICES_ILS.premium * 10;
    expect(createSubscriptionCheckoutLink).toHaveBeenCalledWith(
      "biz1",
      "premium",
      expect.any(String),
      "annual",
      annual - credit
    );
    expect(res.body.creditedIls).toBe(credit);
    // The cycle must not flip to annual before the money actually arrives.
    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });

  it("still charges the saved token when there is one", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ ...noToken, subscriptionToken: "tok_live" });
    chargeSubscriptionToken.mockResolvedValue({ success: true });
    mockPrisma.business.update.mockResolvedValue({ walletBalanceAgorot: 5000 });

    const res = await request(app).post("/api/billing/payplus/wallet/topup").send({ amountIls: 50 });

    expect(res.status).toBe(200);
    expect(res.body.walletBalanceAgorot).toBe(5000);
    expect(createWalletTopupLink).not.toHaveBeenCalled();
  });

  it("reports a top-up charge failure in Hebrew, not as a raw English string", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ ...noToken, subscriptionToken: "tok_live" });
    chargeSubscriptionToken.mockResolvedValue({ success: false, error: "card declined" });

    const res = await request(app).post("/api/billing/payplus/wallet/topup").send({ amountIls: 50 });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("טעינת הארנק נכשלה");
  });
});

describe("wallet top-up webhook", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.PAYPLUS_BILLING_WEBHOOK_SECRET = "correct-horse-battery-staple";
    const { payplusBillingWebhookRouter } = await import("./payplusBillingRoutes.js");
    app = express();
    app.use(express.json());
    app.use("/webhook/billing/payplus", payplusBillingWebhookRouter);
  });

  const post = (body: unknown) =>
    request(app).post("/webhook/billing/payplus/correct-horse-battery-staple").send(body);
  const settle = () => new Promise((r) => setImmediate(r));

  it("credits the wallet from the stored amount, not from the callback body", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      id: "biz1",
      checkoutPurpose: "wallet",
      checkoutAmountIls: 50,
      checkoutPlan: null,
      checkoutCycle: null,
    });
    mockPrisma.business.update.mockResolvedValue({ walletBalanceAgorot: 5000 });

    // The inflated `amount` here is exactly what must be ignored.
    await post({ data: { status_code: "000", more_info: "a1b2c3d4e5f60718", amount: 99999 } });
    await settle();

    expect(mockPrisma.business.update.mock.calls[0][0].data.walletBalanceAgorot).toEqual({ increment: 5000 });
  });

  it("saves a returned token so the next top-up is one click", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      id: "biz1",
      checkoutPurpose: "wallet",
      checkoutAmountIls: 50,
      checkoutPlan: null,
      checkoutCycle: null,
    });
    mockPrisma.business.update.mockResolvedValue({ walletBalanceAgorot: 5000 });

    await post({ data: { status_code: "000", more_info: "a1b2c3d4e5f60718", token_uid: "tok_new" } });
    await settle();

    expect(mockPrisma.business.update.mock.calls[0][0].data.subscriptionToken).toBe("enc:tok_new");
  });

  it("never clears an existing token when the top-up returns none", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      id: "biz1",
      checkoutPurpose: "wallet",
      checkoutAmountIls: 50,
      checkoutPlan: null,
      checkoutCycle: null,
    });
    mockPrisma.business.update.mockResolvedValue({ walletBalanceAgorot: 5000 });

    await post({ data: { status_code: "000", more_info: "a1b2c3d4e5f60718" } });
    await settle();

    expect(mockPrisma.business.update.mock.calls[0][0].data).not.toHaveProperty("subscriptionToken");
  });

  it("consumes the ref so a replayed callback cannot credit twice", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      id: "biz1",
      checkoutPurpose: "wallet",
      checkoutAmountIls: 50,
      checkoutPlan: null,
      checkoutCycle: null,
    });
    mockPrisma.business.update.mockResolvedValue({ walletBalanceAgorot: 5000 });

    await post({ data: { status_code: "000", more_info: "a1b2c3d4e5f60718" } });
    await settle();

    expect(mockPrisma.business.update.mock.calls[0][0].data.checkoutRef).toBeNull();
  });

  it("treats a null purpose as a subscription — in-flight checkouts predate the column", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      id: "biz1",
      checkoutPurpose: null,
      checkoutPlan: "premium",
      checkoutCycle: "annual",
      checkoutAmountIls: null,
    });
    mockPrisma.business.update.mockResolvedValue({});

    await post({ data: { status_code: "000", more_info: "a1b2c3d4e5f60718", token_uid: "tok_1" } });
    await settle();

    expect(mockPrisma.business.update.mock.calls[0][0].data.subscriptionStatus).toBe("active");
  });

  /**
   * The subscription branch had the mirror-image of the bug the wallet branch is guarded against
   * two tests up: it wrote `subscriptionToken: null` whenever a callback came back without one.
   * Nothing else in the codebase ever nulls that column, so a cancelled or past-due business keeps
   * the card that used to work — and a hosted checkout page is exactly how such a business
   * re-subscribes. One callback without a token (PayPlus omitted it, or the Token/List recovery
   * timed out) turned a paying customer into an active subscription that the nightly job then
   * skipped for having no card.
   */
  it("saves the token and customer id together when the subscription callback carries them", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      id: "biz1",
      checkoutPurpose: "subscription",
      checkoutPlan: "premium",
      checkoutCycle: "monthly",
      checkoutAmountIls: null,
    });
    mockPrisma.business.update.mockResolvedValue({});

    await post({
      data: { status_code: "000", more_info: "a1b2c3d4e5f60718", token_uid: "tok_sub", customer_uid: "cust_sub" },
    });
    await settle();

    const data = mockPrisma.business.update.mock.calls[0][0].data;
    expect(data.subscriptionToken).toBe("enc:tok_sub");
    // Both halves or neither: PayPlus rejects a token charge that arrives without customer_uid.
    expect(data.subscriptionCustomerUid).toBe("cust_sub");
  });

  it("never clears an existing card when the subscription callback returns no token", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      id: "biz1",
      checkoutPurpose: "subscription",
      checkoutPlan: "premium",
      checkoutCycle: "monthly",
      checkoutAmountIls: null,
    });
    mockPrisma.business.update.mockResolvedValue({});

    await post({ data: { status_code: "000", more_info: "a1b2c3d4e5f60718" } });
    await settle();

    const data = mockPrisma.business.update.mock.calls[0][0].data;
    // Still activated — the customer paid — but the card they already had is left alone.
    expect(data.subscriptionStatus).toBe("active");
    expect(data).not.toHaveProperty("subscriptionToken");
    expect(data).not.toHaveProperty("subscriptionCustomerUid");
  });

  it("ignores a wallet callback with no stored amount rather than crediting zero", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      id: "biz1",
      checkoutPurpose: "wallet",
      checkoutAmountIls: null,
      checkoutPlan: null,
      checkoutCycle: null,
    });

    await post({ data: { status_code: "000", more_info: "a1b2c3d4e5f60718" } });
    await settle();

    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });
});
