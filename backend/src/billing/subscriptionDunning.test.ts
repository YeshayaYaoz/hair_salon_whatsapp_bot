import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  business: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
};
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/crypto.js", () => ({ decryptSecret: (v: string) => v }));
vi.mock("../webhook/whatsappClient.js", () => ({ sendWhatsAppMessage: vi.fn() }));

const sendAdminAlertEmail = vi.fn();
vi.mock("../lib/email.js", () => ({ sendAdminAlertEmail: (...a: unknown[]) => sendAdminAlertEmail(...a) }));

const chargeSubscriptionToken = vi.fn();
const fetchCustomerUidForToken = vi.fn();
vi.mock("./payplusSubscription.js", async () => {
  const actual = await vi.importActual<typeof import("./payplusSubscription.js")>("./payplusSubscription.js");
  return {
    ...actual,
    chargeSubscriptionToken: (...a: unknown[]) => chargeSubscriptionToken(...a),
    fetchCustomerUidForToken: (...a: unknown[]) => fetchCustomerUidForToken(...a),
  };
});

const { runSubscriptionBillingJob } = await import("./subscriptionBillingJob.js");

const DAY_MS = 24 * 60 * 60 * 1000;

function dueBusiness(overrides: Record<string, unknown> = {}) {
  return {
    id: "biz1",
    name: "צימר בנחת רוח",
    subscriptionToken: "tok",
    subscriptionPlan: "premium",
    billingCycle: "monthly",
    billingCyclesCompleted: 2,
    loyaltyDiscountIls: 0,
    paymentProvider: null,
    invoiceProvider: null,
    billingFailedAttempts: 0,
    notificationPhone: null,
    whatsappPhoneNumberId: null,
    whatsappAccessToken: null,
    ...overrides,
  };
}

/** The last update() call's `data`, which is where every decision this job makes ends up. */
const lastData = () => mockPrisma.business.update.mock.calls.at(-1)![0].data;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.business.updateMany.mockResolvedValue({ count: 1 }); // claim succeeds by default
  mockPrisma.business.update.mockResolvedValue({});
  sendAdminAlertEmail.mockResolvedValue(undefined);
  fetchCustomerUidForToken.mockResolvedValue(undefined);
});

/**
 * PayPlus rejects a token charge that arrives without the customer_uid the card belongs to. Rows
 * whose card was stored before that id was kept alongside it hold only half of what a renewal
 * needs — and the gap is invisible until the renewal fires, weeks after the customer paid.
 */
describe("customer_uid recovery before a renewal", () => {
  it("uses the stored id without a lookup when the row already has one", async () => {
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness({ subscriptionCustomerUid: "cust-stored" })]);
    chargeSubscriptionToken.mockResolvedValue({ success: true });

    await runSubscriptionBillingJob();

    expect(fetchCustomerUidForToken).not.toHaveBeenCalled();
    expect(chargeSubscriptionToken.mock.calls[0][3]).toBe("cust-stored");
  });

  it("recovers the id from the token and persists it, so the lookup happens once", async () => {
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness({ subscriptionCustomerUid: null })]);
    fetchCustomerUidForToken.mockResolvedValue("cust-recovered");
    chargeSubscriptionToken.mockResolvedValue({ success: true });

    await runSubscriptionBillingJob();

    expect(fetchCustomerUidForToken).toHaveBeenCalledWith("tok");
    expect(chargeSubscriptionToken.mock.calls[0][3]).toBe("cust-recovered");
    expect(
      mockPrisma.business.update.mock.calls.some((c) => c[0].data?.subscriptionCustomerUid === "cust-recovered")
    ).toBe(true);
  });

  it("still attempts the charge when the id cannot be recovered", async () => {
    // A renewal that might work beats one that certainly does not — and a real rejection is
    // reported by PayPlus with a reason, which a skipped charge never would be.
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness({ subscriptionCustomerUid: null })]);
    fetchCustomerUidForToken.mockResolvedValue(undefined);
    chargeSubscriptionToken.mockResolvedValue({ success: true });

    await runSubscriptionBillingJob();

    expect(chargeSubscriptionToken).toHaveBeenCalledTimes(1);
    expect(chargeSubscriptionToken.mock.calls[0][3]).toBeUndefined();
  });
});

/**
 * A crash between PayPlus taking the money and our own update landing used to mean the next run
 * charged the same business again — and Railway redeploys make that a real scenario. The claim is
 * taken before the charge, so a lost claim must stop the charge from happening at all.
 */
describe("double-charge guard", () => {
  it("does not charge when the claim is lost to another run", async () => {
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness()]);
    mockPrisma.business.updateMany.mockResolvedValue({ count: 0 });

    await runSubscriptionBillingJob();

    expect(chargeSubscriptionToken).not.toHaveBeenCalled();
    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });

  it("claims before charging, not after", async () => {
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness()]);
    chargeSubscriptionToken.mockResolvedValue({ success: true });

    await runSubscriptionBillingJob();

    expect(mockPrisma.business.updateMany).toHaveBeenCalled();
    expect(mockPrisma.business.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      chargeSubscriptionToken.mock.invocationCallOrder[0]
    );
  });

  it("only claims a row not already claimed today", async () => {
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness()]);
    chargeSubscriptionToken.mockResolvedValue({ success: true });

    await runSubscriptionBillingJob();

    const where = mockPrisma.business.updateMany.mock.calls[0][0].where;
    expect(where.id).toBe("biz1");
    expect(where.OR).toHaveLength(2);
  });
});

describe("dunning", () => {
  it("keeps the business active on a first failure and retries in 2 days", async () => {
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness({ billingFailedAttempts: 0 })]);
    chargeSubscriptionToken.mockResolvedValue({ success: false, error: "declined" });

    await runSubscriptionBillingJob();

    const data = lastData();
    expect(data.subscriptionStatus).toBeUndefined(); // still active — the bot keeps running
    expect(data.billingFailedAttempts).toBe(1);
    const gap = new Date(data.nextBillingDate).getTime() - Date.now();
    expect(gap).toBeGreaterThan(1.9 * DAY_MS);
    expect(gap).toBeLessThan(2.1 * DAY_MS);
  });

  it("still holds off on the second failure", async () => {
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness({ billingFailedAttempts: 1 })]);
    chargeSubscriptionToken.mockResolvedValue({ success: false, error: "declined" });

    await runSubscriptionBillingJob();

    expect(lastData().subscriptionStatus).toBeUndefined();
    expect(lastData().billingFailedAttempts).toBe(2);
  });

  it("marks past_due on the third failure and stops re-arming the due date", async () => {
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness({ billingFailedAttempts: 2 })]);
    chargeSubscriptionToken.mockResolvedValue({ success: false, error: "declined" });

    await runSubscriptionBillingJob();

    const data = lastData();
    expect(data.subscriptionStatus).toBe("past_due");
    // A due date in the past would keep re-charging a business that has already been cut off.
    expect(data.nextBillingDate).toBeUndefined();
  });

  it("only emails the operator once the account has actually stopped", async () => {
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness({ billingFailedAttempts: 0 })]);
    chargeSubscriptionToken.mockResolvedValue({ success: false, error: "declined" });
    await runSubscriptionBillingJob();
    expect(sendAdminAlertEmail).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockPrisma.business.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.business.update.mockResolvedValue({});
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness({ billingFailedAttempts: 2 })]);
    chargeSubscriptionToken.mockResolvedValue({ success: false, error: "declined" });
    await runSubscriptionBillingJob();
    expect(sendAdminAlertEmail).toHaveBeenCalledOnce();
  });

  it("clears the failure count once a charge finally succeeds", async () => {
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness({ billingFailedAttempts: 2 })]);
    chargeSubscriptionToken.mockResolvedValue({ success: true });

    await runSubscriptionBillingJob();

    expect(lastData().billingFailedAttempts).toBe(0);
  });
});
