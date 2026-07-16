import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  business: { findUnique: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));

const { requireActiveSubscription, hasActiveSubscription } = await import("./subscriptionGate.js");

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireActiveSubscription", () => {
  it("calls next() for an active subscription with no block", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({ subscriptionStatus: "active", blockedAt: null });
    const next = vi.fn();
    await requireActiveSubscription({ businessId: "biz1" } as any, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("calls next() for a trial subscription", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({ subscriptionStatus: "trial", blockedAt: null });
    const next = vi.fn();
    await requireActiveSubscription({ businessId: "biz1" } as any, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("blocks with 402 for a past_due subscription", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({ subscriptionStatus: "past_due", blockedAt: null });
    const next = vi.fn();
    const res = mockRes();
    await requireActiveSubscription({ businessId: "biz1" } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);
  });

  it("blocks with 402 for a canceled subscription", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({ subscriptionStatus: "canceled", blockedAt: null });
    const next = vi.fn();
    const res = mockRes();
    await requireActiveSubscription({ businessId: "biz1" } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(402);
  });

  it("blocks with 403 when the business is blocked, EVEN with an otherwise-active subscription", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({ subscriptionStatus: "active", blockedAt: new Date() });
    const next = vi.fn();
    const res = mockRes();
    await requireActiveSubscription({ businessId: "biz1" } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("blocks with 403 when the business no longer exists", async () => {
    mockPrisma.business.findUnique.mockResolvedValue(null);
    const next = vi.fn();
    const res = mockRes();
    await requireActiveSubscription({ businessId: "gone" } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("hasActiveSubscription", () => {
  it("returns true for trial/active and not blocked", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({ subscriptionStatus: "active", blockedAt: null });
    expect(await hasActiveSubscription("biz1")).toBe(true);
  });

  it("returns false when blocked, even if subscriptionStatus is active — this is what stops the bot from replying to a blocked business's customers", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({ subscriptionStatus: "active", blockedAt: new Date() });
    expect(await hasActiveSubscription("biz1")).toBe(false);
  });

  it("returns false for past_due/canceled", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({ subscriptionStatus: "past_due", blockedAt: null });
    expect(await hasActiveSubscription("biz1")).toBe(false);
  });

  it("returns false when the business doesn't exist", async () => {
    mockPrisma.business.findUnique.mockResolvedValue(null);
    expect(await hasActiveSubscription("gone")).toBe(false);
  });
});
