import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  business: { findMany: vi.fn(), count: vi.fn() },
  appointment: { count: vi.fn() },
};
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("./email.js", () => ({ sendAdminAlertEmail: vi.fn() }));
vi.mock("./jobStatus.js", () => ({ getJobStatuses: vi.fn().mockResolvedValue([]) }));

const { collectHealthSnapshot } = await import("./healthDigest.js");

function business(overrides: Record<string, unknown> = {}) {
  return {
    name: "צימר בנחת רוח",
    subscriptionStatus: "active",
    blockedAt: null,
    whatsappAccessToken: "tok",
    whatsappTokenValid: true,
    notificationPhone: "972500000000",
    botEnabled: true,
    subscriptionPlan: "premium",
    subscriptionToken: "card-token",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.appointment.count.mockResolvedValue(0);
  mockPrisma.business.count.mockResolvedValue(0);
});

/**
 * The gap this closes: the billing job's query requires a subscription token, so a business
 * without one is skipped every single night with no log line and no alert — an active paid plan
 * that is quietly never charged. Nothing else in the system notices.
 */
describe("unbillable businesses", () => {
  it("flags an active paid plan with no saved card", async () => {
    mockPrisma.business.findMany.mockResolvedValue([business({ subscriptionToken: null })]);
    const snapshot = await collectHealthSnapshot();
    expect(snapshot.unbillable).toEqual(["צימר בנחת רוח"]);
  });

  it("says nothing about a business that has a card", async () => {
    mockPrisma.business.findMany.mockResolvedValue([business()]);
    expect((await collectHealthSnapshot()).unbillable).toEqual([]);
  });

  it("ignores trials — there is nothing to charge them for yet", async () => {
    mockPrisma.business.findMany.mockResolvedValue([
      business({ subscriptionStatus: "trial", subscriptionPlan: null, subscriptionToken: null }),
    ]);
    expect((await collectHealthSnapshot()).unbillable).toEqual([]);
  });

  it("ignores a blocked business — not billing it is the intended outcome", async () => {
    mockPrisma.business.findMany.mockResolvedValue([
      business({ subscriptionToken: null, blockedAt: new Date() }),
    ]);
    expect((await collectHealthSnapshot()).unbillable).toEqual([]);
  });

  it("ignores past_due — that one already stopped on purpose", async () => {
    mockPrisma.business.findMany.mockResolvedValue([
      business({ subscriptionStatus: "past_due", subscriptionToken: null }),
    ]);
    expect((await collectHealthSnapshot()).unbillable).toEqual([]);
  });
});
