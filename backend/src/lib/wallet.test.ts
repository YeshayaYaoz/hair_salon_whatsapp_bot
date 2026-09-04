import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  business: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
};
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));

const { meterOutboundMessage, MESSAGE_QUOTA_BY_PLAN, COST_PER_MESSAGE_AGOROT } = await import("./wallet.js");

/**
 * Metering had no tests, and it is the only place in the codebase that spends a customer's money
 * without anyone pressing anything: every proactive send past the plan quota takes
 * COST_PER_MESSAGE_AGOROT out of the prepaid wallet, automatically, on a nightly job's schedule.
 * An off-by-one at the quota boundary is a charge for a message the plan already covered.
 */
function business(overrides: Record<string, unknown> = {}) {
  return {
    subscriptionPlan: "premium",
    messagesUsedThisCycle: 0,
    walletBalanceAgorot: 5000,
    ...overrides,
  };
}

/** What the update() call actually wrote — the only place the money decision is visible. */
const written = () => mockPrisma.business.update.mock.calls.at(-1)![0].data;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.business.update.mockResolvedValue({ walletBalanceAgorot: 5000 });
});

describe("inside the plan quota", () => {
  it("counts the message and leaves the wallet alone", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business({ messagesUsedThisCycle: 10 }));

    const result = await meterOutboundMessage("biz1");

    expect(written().messagesUsedThisCycle).toEqual({ increment: 1 });
    expect(written()).not.toHaveProperty("walletBalanceAgorot");
    expect(result.overQuota).toBe(false);
  });

  it("still leaves the wallet alone on the last included message", async () => {
    // 999 used on Premium: this send is the 1000th, the last one the plan covers. Charging here
    // would bill every business for one message it had already paid for, every cycle.
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      business({ messagesUsedThisCycle: MESSAGE_QUOTA_BY_PLAN.premium - 1 })
    );

    const result = await meterOutboundMessage("biz1");

    expect(written()).not.toHaveProperty("walletBalanceAgorot");
    expect(result.overQuota).toBe(false);
  });
});

describe("past the plan quota", () => {
  it("charges the wallet on the first message beyond it", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      business({ messagesUsedThisCycle: MESSAGE_QUOTA_BY_PLAN.premium })
    );

    const result = await meterOutboundMessage("biz1");

    expect(written().walletBalanceAgorot).toEqual({ decrement: COST_PER_MESSAGE_AGOROT });
    expect(result.overQuota).toBe(true);
  });

  it("uses the quota of the plan actually held, not a fixed one", async () => {
    // Standard's quota is a third of Premium's. A business on Standard at 400 messages is over;
    // the same count on Premium is not, and one shared constant would bill one of them wrongly.
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      business({ subscriptionPlan: "standard", messagesUsedThisCycle: 400 })
    );
    expect((await meterOutboundMessage("biz1")).overQuota).toBe(true);

    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      business({ subscriptionPlan: "premium", messagesUsedThisCycle: 400 })
    );
    expect((await meterOutboundMessage("biz2")).overQuota).toBe(false);
  });

  it("falls back to the smallest quota for a business with no plan", async () => {
    // Not unlimited, which would give a trial account the run of the account's message budget, and
    // not zero, which would bill a trial for its very first reminder.
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      business({ subscriptionPlan: null, messagesUsedThisCycle: MESSAGE_QUOTA_BY_PLAN.standard - 1 })
    );
    expect((await meterOutboundMessage("biz1")).overQuota).toBe(false);

    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      business({ subscriptionPlan: null, messagesUsedThisCycle: MESSAGE_QUOTA_BY_PLAN.standard })
    );
    expect((await meterOutboundMessage("biz1")).overQuota).toBe(true);
  });

  it("does the same for a plan name it does not recognise", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      business({ subscriptionPlan: "enterprise-2027", messagesUsedThisCycle: MESSAGE_QUOTA_BY_PLAN.standard })
    );
    expect((await meterOutboundMessage("biz1")).overQuota).toBe(true);
  });
});

describe("a wallet that cannot cover the send", () => {
  it("flags the shortfall but still reports the send as metered", async () => {
    // The send itself is never blocked — a booking reminder lost to a billing technicality costs
    // the business more than the thirty agorot does. The flag is what surfaces it to them and to
    // the operator instead.
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      business({ messagesUsedThisCycle: MESSAGE_QUOTA_BY_PLAN.premium, walletBalanceAgorot: 10 })
    );
    mockPrisma.business.update.mockResolvedValue({ walletBalanceAgorot: -20 });

    const result = await meterOutboundMessage("biz1");

    expect(result.insufficientBalance).toBe(true);
    expect(result.metered).toBe(true);
    expect(result.walletBalanceAgorot).toBe(-20);
  });

  it("does not flag a shortfall for a message the plan covered", async () => {
    // A negative balance left over from a previous cycle must not make every included message
    // look like an unpaid one.
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business({ messagesUsedThisCycle: 5 }));
    mockPrisma.business.update.mockResolvedValue({ walletBalanceAgorot: -500 });

    const result = await meterOutboundMessage("biz1");

    expect(result.overQuota).toBe(false);
    expect(result.insufficientBalance).toBe(false);
  });
});

/**
 * These numbers are duplicated in admin/app/dashboard/billing/page.tsx, which tells owners what
 * their plan includes, and they are what the plan cards are sold on. A test cannot reach the
 * frontend copy, so it pins these instead: changing a quota should be a deliberate edit here that
 * fails until the pricing page is updated to match.
 */
describe("the published quotas", () => {
  it("are the ones the pricing page promises", () => {
    expect(MESSAGE_QUOTA_BY_PLAN).toEqual({ standard: 300, premium: 1000, ultra: 3000 });
  });

  it("charge ₪0.30 per message beyond them", () => {
    expect(COST_PER_MESSAGE_AGOROT).toBe(30);
  });
});
