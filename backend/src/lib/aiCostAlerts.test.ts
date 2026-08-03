import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  apiUsageEvent: { groupBy: vi.fn() },
  business: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
};
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));

const sendAdminAlertEmail = vi.fn();
vi.mock("./email.js", () => ({ sendAdminAlertEmail: (...a: unknown[]) => sendAdminAlertEmail(...a) }));

const { collectCostStatuses, runAiCostAlertJob, budgetAgorotFor, AI_BUDGET_AGOROT_DEFAULT } = await import(
  "./aiCostAlerts.js"
);

/** Premium budget is ₪74.75, so 70% is ₪52.33 and 100% is ₪74.75. */
const PREMIUM_BUDGET = budgetAgorotFor("premium");

function setup(spentAgorot: number, stepSent = 0, plan: string | null = "premium") {
  mockPrisma.apiUsageEvent.groupBy.mockResolvedValue([
    { businessId: "biz1", _sum: { costAgorot: spentAgorot }, _count: { _all: 40 } },
  ]);
  mockPrisma.business.findMany.mockResolvedValue([{ id: "biz1", name: 'צימר "בנחת רוח"', subscriptionPlan: plan }]);
  mockPrisma.business.findUnique.mockResolvedValue({ aiCostAlertStepSent: stepSent });
  mockPrisma.business.update.mockResolvedValue({});
}

beforeEach(() => {
  vi.clearAllMocks();
  sendAdminAlertEmail.mockResolvedValue(undefined);
});

describe("budgetAgorotFor", () => {
  it("scales the budget with the plan's revenue", () => {
    expect(budgetAgorotFor("premium")).toBeGreaterThan(budgetAgorotFor("standard"));
  });

  it("falls back to the flat budget for trials and for any plan it doesn't know", () => {
    expect(budgetAgorotFor(null)).toBe(AI_BUDGET_AGOROT_DEFAULT);
    // A plan added later must not silently opt out of alerting entirely.
    expect(budgetAgorotFor("enterprise")).toBe(AI_BUDGET_AGOROT_DEFAULT);
  });
});

describe("collectCostStatuses", () => {
  it("reports a business with no usage at 0% rather than omitting it", async () => {
    mockPrisma.apiUsageEvent.groupBy.mockResolvedValue([]);
    mockPrisma.business.findMany.mockResolvedValue([{ id: "biz1", name: "A", subscriptionPlan: "premium" }]);
    const [s] = await collectCostStatuses();
    expect(s.spentAgorot).toBe(0);
    expect(s.step).toBe(0);
  });

  it("only looks at live businesses — a blocked or lapsed one isn't actionable", async () => {
    setup(0);
    await collectCostStatuses();
    expect(mockPrisma.business.findMany.mock.calls[0][0].where).toEqual({
      blockedAt: null,
      subscriptionStatus: { in: ["trial", "active"] },
    });
  });

  it("counts only claude spend from the last 30 days", async () => {
    setup(0);
    const now = new Date("2026-08-03T00:00:00Z");
    await collectCostStatuses(now);
    const where = mockPrisma.apiUsageEvent.groupBy.mock.calls[0][0].where;
    expect(where.kind).toBe("claude");
    expect(where.createdAt.gte).toEqual(new Date("2026-07-04T00:00:00Z"));
  });
});

describe("runAiCostAlertJob", () => {
  it("stays silent below 70%", async () => {
    setup(Math.round(PREMIUM_BUDGET * 0.69));
    await runAiCostAlertJob();
    expect(sendAdminAlertEmail).not.toHaveBeenCalled();
  });

  it("alerts on crossing 70% and records the step", async () => {
    setup(Math.round(PREMIUM_BUDGET * 0.72));
    await runAiCostAlertJob();
    expect(sendAdminAlertEmail).toHaveBeenCalledOnce();
    expect(sendAdminAlertEmail.mock.calls[0][0]).toContain('צימר "בנחת רוח"');
    expect(mockPrisma.business.update).toHaveBeenCalledWith({
      where: { id: "biz1" },
      data: { aiCostAlertStepSent: 70 },
    });
  });

  it("does not repeat the 70% mail while the business sits above it", async () => {
    setup(Math.round(PREMIUM_BUDGET * 0.8), 70);
    await runAiCostAlertJob();
    expect(sendAdminAlertEmail).not.toHaveBeenCalled();
    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });

  it("sends a second mail at 100% even though 70% already went out", async () => {
    setup(Math.round(PREMIUM_BUDGET * 1.1), 70);
    await runAiCostAlertJob();
    expect(sendAdminAlertEmail).toHaveBeenCalledOnce();
    expect(sendAdminAlertEmail.mock.calls[0][0]).toContain("110%");
  });

  it("re-arms without mailing once spend ages back out of the window", async () => {
    setup(Math.round(PREMIUM_BUDGET * 0.2), 100);
    await runAiCostAlertJob();
    expect(sendAdminAlertEmail).not.toHaveBeenCalled();
    expect(mockPrisma.business.update).toHaveBeenCalledWith({
      where: { id: "biz1" },
      data: { aiCostAlertStepSent: 0 },
    });
  });

  it("still records the step when the mail fails, so a broken mailer can't cause a loop", async () => {
    setup(Math.round(PREMIUM_BUDGET * 0.9));
    sendAdminAlertEmail.mockRejectedValue(new Error("resend down"));
    await expect(runAiCostAlertJob()).resolves.toBeUndefined();
    expect(mockPrisma.business.update).toHaveBeenCalledWith({
      where: { id: "biz1" },
      data: { aiCostAlertStepSent: 70 },
    });
  });

  it("uses the trial budget for a business with no plan", async () => {
    // ₪15 is comfortably under premium's 70% but past the trial budget's.
    setup(1500, 0, null);
    await runAiCostAlertJob();
    expect(sendAdminAlertEmail).toHaveBeenCalledOnce();
    expect(sendAdminAlertEmail.mock.calls[0][0]).toContain("75%");
  });
});
