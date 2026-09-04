import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  business: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
};
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/crypto.js", () => ({ decryptSecret: (v: string) => v }));
const sendWhatsAppMessage = vi.fn();
vi.mock("../webhook/whatsappClient.js", () => ({
  sendWhatsAppMessage: (...a: unknown[]) => sendWhatsAppMessage(...a),
}));

// The job no longer sends free-form WhatsApp itself — lib/ownerNotify picks the session message,
// the approved template or email depending on the owner's 24-hour window. That helper is the seam
// the owner-facing wording is asserted through.
const notifyOwner = vi.fn();
vi.mock("../lib/ownerNotify.js", () => ({ notifyOwner: (...a: unknown[]) => notifyOwner(...a) }));

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

/**
 * A subscription that is active, on a plan, and past its billing date but holds no saved card used
 * to be filtered out of this job's query entirely. Nothing charged it, nothing failed, nothing was
 * logged, and neither the owner nor we were told — the renewal simply never happened, and the row
 * sat there indefinitely with a due date in the past. A business reaches that state legitimately:
 * activated by hand, or a paid checkout whose callback carried no token and whose Token/List
 * recovery came up empty.
 */
describe("a due subscription with no saved card", () => {
  const noCard = () => dueBusiness({ subscriptionToken: null, notificationPhone: "972501234567", whatsappPhoneNumberId: "pn1", whatsappAccessToken: "tok" });

  /**
   * This one asserts the query, not the loop — and it is the assertion that actually covers the
   * regression. prisma is mocked here, so findMany returns whatever a test hands it no matter what
   * the where clause says; every other case below would pass even with the old filter still in
   * place. The filter is the bug, so the filter is what gets checked.
   */
  it("is selected by the query at all — the filter that hid it is gone", async () => {
    mockPrisma.business.findMany.mockResolvedValue([]);

    await runSubscriptionBillingJob();

    const where = mockPrisma.business.findMany.mock.calls.at(-1)![0].where;
    expect(where.subscriptionStatus).toBe("active");
    expect(where.subscriptionPlan).toEqual({ not: null });
    // The whole point: no constraint on subscriptionToken, so cardless rows come back too.
    expect(where).not.toHaveProperty("subscriptionToken");
  });

  it("is picked up and dunned rather than skipped", async () => {
    mockPrisma.business.findMany.mockResolvedValue([noCard()]);

    await runSubscriptionBillingJob();

    // No charge was attempted, because there is nothing to charge with.
    expect(chargeSubscriptionToken).not.toHaveBeenCalled();
    // But it counts as a failed attempt, so the dunning ladder advances instead of stalling.
    expect(lastData().billingFailedAttempts).toBe(1);
    expect(lastData().nextBillingDate).toBeInstanceOf(Date);
  });

  it("asks the owner for a card rather than reporting a decline that never happened", async () => {
    mockPrisma.business.findMany.mockResolvedValue([noCard()]);

    await runSubscriptionBillingJob();

    const [businessId, text] = notifyOwner.mock.calls.at(-1)! as [string, string];
    expect(businessId).toBe("biz1");
    expect(text).toContain("אין אמצעי תשלום שמור");
    expect(text).toContain("/dashboard/billing");
    // "The charge did not go through" would send them hunting through their bank statement.
    expect(text).not.toContain("לא עבר");
  });

  it("never calls Token/View when there is no token to look up", async () => {
    mockPrisma.business.findMany.mockResolvedValue([noCard()]);

    await runSubscriptionBillingJob();

    expect(fetchCustomerUidForToken).not.toHaveBeenCalled();
  });

  it("stops the bot only after the ladder runs out, exactly like a declined card", async () => {
    mockPrisma.business.findMany.mockResolvedValue([
      dueBusiness({ subscriptionToken: null, billingFailedAttempts: 2 }),
    ]);

    await runSubscriptionBillingJob();

    expect(lastData().subscriptionStatus).toBe("past_due");
    expect(sendAdminAlertEmail).toHaveBeenCalledOnce();
  });

  it("still charges normally when a card is present", async () => {
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness()]);
    chargeSubscriptionToken.mockResolvedValue({ success: true });

    await runSubscriptionBillingJob();

    expect(chargeSubscriptionToken).toHaveBeenCalledOnce();
    expect(lastData().billingFailedAttempts).toBe(0);
  });
});

/**
 * What a successful charge writes.
 *
 * The failure ladder above is thoroughly covered; the success branch was not, and it is where the
 * quieter money bugs live. Nothing here throws when it goes wrong — a coupon consumed on a failed
 * attempt, a quota never reset, a loyalty discount awarded twice — it just bills the wrong amount
 * next month, to someone who has no way of knowing.
 */
describe("what a successful charge writes", () => {
  beforeEach(() => {
    chargeSubscriptionToken.mockResolvedValue({ success: true });
  });

  it("resets the message quota, because the new cycle is the one being paid for", async () => {
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness({ messagesUsedThisCycle: 812 })]);
    await runSubscriptionBillingJob();
    expect(lastData().messagesUsedThisCycle).toBe(0);
  });

  it("does NOT reset the quota when the charge failed", async () => {
    // Otherwise a declining card buys a fresh allowance every retry — three free quotas on the way
    // to past_due, for the businesses least likely to be paying for them.
    chargeSubscriptionToken.mockResolvedValue({ success: false, error: "declined" });
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness({ messagesUsedThisCycle: 812 })]);
    await runSubscriptionBillingJob();
    expect(lastData()).not.toHaveProperty("messagesUsedThisCycle");
  });

  it("advances the due date by the monthly period", async () => {
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness()]);
    await runSubscriptionBillingJob();
    const next = lastData().nextBillingDate as Date;
    expect(Math.round((next.getTime() - Date.now()) / DAY_MS)).toBe(30);
  });

  it("advances an annual subscriber by a year, not a month", async () => {
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness({ billingCycle: "annual" })]);
    await runSubscriptionBillingJob();
    const next = lastData().nextBillingDate as Date;
    // A month here would bill an annual customer twelve times for a year of service.
    expect(Math.round((next.getTime() - Date.now()) / DAY_MS)).toBeGreaterThan(300);
  });
});

/**
 * The coupon must be spent by a charge that actually collected money.
 *
 * Counting a cycle down on a failed attempt silently raises the price of the retry — for a business
 * whose card just declined, and in a way nobody could reconstruct afterwards.
 */
describe("coupon cycles", () => {
  const withCoupon = () => dueBusiness({ couponDiscountIls: 50, couponCyclesRemaining: 3 });

  it("counts down on a successful charge", async () => {
    chargeSubscriptionToken.mockResolvedValue({ success: true });
    mockPrisma.business.findMany.mockResolvedValue([withCoupon()]);
    await runSubscriptionBillingJob();
    expect(lastData().couponCyclesRemaining).toBe(2);
  });

  it("does not count down on a failed charge", async () => {
    chargeSubscriptionToken.mockResolvedValue({ success: false, error: "declined" });
    mockPrisma.business.findMany.mockResolvedValue([withCoupon()]);
    await runSubscriptionBillingJob();
    expect(lastData()).not.toHaveProperty("couponCyclesRemaining");
  });

  it("charges the discounted amount while cycles remain", async () => {
    chargeSubscriptionToken.mockResolvedValue({ success: true });
    mockPrisma.business.findMany.mockResolvedValue([withCoupon()]);
    await runSubscriptionBillingJob();
    // Premium 374.90 less the ₪50 coupon. Asserted through the charge call, not the stored row:
    // the row records what happened, this is the number that reaches the card.
    expect(chargeSubscriptionToken.mock.calls[0][1]).toBeCloseTo(324.9, 2);
  });

  it("charges full price once the coupon is spent", async () => {
    chargeSubscriptionToken.mockResolvedValue({ success: true });
    mockPrisma.business.findMany.mockResolvedValue([
      dueBusiness({ couponDiscountIls: 50, couponCyclesRemaining: 0 }),
    ]);
    await runSubscriptionBillingJob();
    expect(chargeSubscriptionToken.mock.calls[0][1]).toBeCloseTo(374.9, 2);
  });
});

/**
 * The loyalty discount is a permanent price cut, so awarding it twice is a permanent overpayment
 * in the customer's favour that nobody would report, and awarding it early gives it to someone who
 * has not earned it. Both are one-line mistakes in the same condition.
 */
describe("the loyalty discount", () => {
  beforeEach(() => {
    chargeSubscriptionToken.mockResolvedValue({ success: true });
  });

  it("is not awarded before the tenure threshold", async () => {
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness({ billingCyclesCompleted: 1 })]);
    await runSubscriptionBillingJob();
    expect(lastData()).not.toHaveProperty("loyaltyDiscountIls");
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it("is awarded once tenure crosses it, and the owner is told", async () => {
    mockPrisma.business.findMany.mockResolvedValue([dueBusiness({ billingCyclesCompleted: 11 })]);
    await runSubscriptionBillingJob();
    expect(lastData().loyaltyDiscountIls).toBeGreaterThan(0);
    expect(notifyOwner).toHaveBeenCalled();
  });

  it("is not awarded a second time to someone who already has it", async () => {
    mockPrisma.business.findMany.mockResolvedValue([
      dueBusiness({ billingCyclesCompleted: 30, loyaltyDiscountIls: 30 }),
    ]);
    await runSubscriptionBillingJob();
    expect(lastData()).not.toHaveProperty("loyaltyDiscountIls");
  });

  it("is not awarded on an annual term, which is already discounted", async () => {
    mockPrisma.business.findMany.mockResolvedValue([
      dueBusiness({ billingCycle: "annual", billingCyclesCompleted: 11 }),
    ]);
    await runSubscriptionBillingJob();
    expect(lastData()).not.toHaveProperty("loyaltyDiscountIls");
  });
});

/**
 * A notification must never be able to cost a charge.
 *
 * The charge has already happened by the time the owner is told about it. If a throw from the
 * notification escaped, the update recording that charge would be skipped — and the next nightly
 * run would find the same business due and charge it again.
 */
describe("notification failures", () => {
  it("does not stop the run when telling the owner throws", async () => {
    chargeSubscriptionToken.mockResolvedValue({ success: true });
    notifyOwner.mockRejectedValue(new Error("meta is down"));
    mockPrisma.business.findMany.mockResolvedValue([
      dueBusiness({ billingCyclesCompleted: 11 }),
      dueBusiness({ id: "biz2", billingCyclesCompleted: 11 }),
    ]);

    await expect(runSubscriptionBillingJob()).resolves.toBeUndefined();
    // Both businesses were still charged — the first one's failed notice did not abort the loop.
    expect(chargeSubscriptionToken).toHaveBeenCalledTimes(2);
  });
});
