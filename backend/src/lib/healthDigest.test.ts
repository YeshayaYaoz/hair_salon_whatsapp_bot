import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  business: { findMany: vi.fn(), count: vi.fn() },
  appointment: { count: vi.fn() },
};
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("./email.js", () => ({ sendAdminAlertEmail: vi.fn() }));
vi.mock("./jobStatus.js", () => ({ getJobStatuses: vi.fn().mockResolvedValue([]) }));
vi.mock("./crypto.js", () => ({ decryptSecret: (s: string) => s }));
const mockCheckLines = vi.fn().mockResolvedValue([]);
vi.mock("./whatsappLineHealth.js", () => ({ checkWhatsAppLines: (...a: unknown[]) => mockCheckLines(...a) }));

const { collectHealthSnapshot } = await import("./healthDigest.js");

function business(overrides: Record<string, unknown> = {}) {
  return {
    name: "צימר בנחת רוח",
    subscriptionStatus: "active",
    blockedAt: null,
    whatsappAccessToken: "tok",
    whatsappTokenValid: true,
    whatsappPhoneNumberId: "pn-1",
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
  mockCheckLines.mockResolvedValue([]);
});

/**
 * Reading `whatsappTokenValid` reported a working customer as broken twice, because it records what
 * our own code observed rather than what Meta says. The digest now asks Meta — and asking has to
 * survive a business whose line cannot be reached at all.
 */
describe("WhatsApp line health", () => {
  it("carries Meta's verdict into the snapshot", async () => {
    mockPrisma.business.findMany.mockResolvedValue([business()]);
    mockCheckLines.mockResolvedValue([{ business: "צימר בנחת רוח", problem: "quality rating RED" }]);

    const snapshot = await collectHealthSnapshot();
    expect(snapshot.lineProblems).toEqual([{ business: "צימר בנחת רוח", problem: "quality rating RED" }]);
  });

  it("only asks about businesses that have both a number and a token", async () => {
    mockPrisma.business.findMany.mockResolvedValue([
      business({ name: "Connected" }),
      business({ name: "No number", whatsappPhoneNumberId: null }),
      business({ name: "No token", whatsappAccessToken: null }),
    ]);

    await collectHealthSnapshot();
    expect(mockCheckLines).toHaveBeenCalledWith([
      { name: "Connected", phoneNumberId: "pn-1", accessToken: "tok" },
    ]);
  });

  it("still produces a digest when the whole check fails", async () => {
    // The digest carries billing and job findings too. Losing all of them because Meta is having a
    // bad morning would trade one blind spot for a larger one.
    mockPrisma.business.findMany.mockResolvedValue([business()]);
    mockCheckLines.mockRejectedValue(new Error("Meta unreachable"));

    const snapshot = await collectHealthSnapshot();
    expect(snapshot.lineProblems).toEqual([]);
    expect(snapshot.activeBusinesses).toBe(1);
  });
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
