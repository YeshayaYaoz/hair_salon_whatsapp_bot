import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = { subscriptionCharge: { create: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() } };
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { claimChargeForPeriod, recordChargeOutcome, periodKeyFor } = await import("./chargeLedger.js");

const dup = () => Object.assign(new Error("unique"), { code: "P2002" });
const row = (status: string, ageMs = 0, transactionId: string | null = null) => ({
  id: "c1", status, transactionId, updatedAt: new Date(Date.now() - ageMs),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.subscriptionCharge.update.mockResolvedValue({});
});

/**
 * The claim guard in the billing job stops a same-day double charge. It did not stop the
 * next-day one: PayPlus takes the money, the process dies before nextBillingDate moves, and
 * tomorrow's run sees a business still due and charges it again. These pin down the four things a
 * run can learn about a period, and that only one of them says "charge".
 */
describe("claimChargeForPeriod", () => {
  it("writes a pending row and says go when nothing is on record", async () => {
    mockPrisma.subscriptionCharge.create.mockResolvedValue({});
    expect(await claimChargeForPeriod("biz", "2026-09-15", 374.9)).toEqual({ kind: "new" });
    expect(mockPrisma.subscriptionCharge.create.mock.calls[0][0].data.status).toBe("pending");
  });

  it("says charged, with the transaction, when this period's money already moved — the crash case", async () => {
    mockPrisma.subscriptionCharge.create.mockRejectedValue(dup());
    mockPrisma.subscriptionCharge.findUniqueOrThrow.mockResolvedValue(row("charged", 0, "tx-9"));
    expect(await claimChargeForPeriod("biz", "2026-09-15", 374.9)).toEqual({ kind: "charged", transactionId: "tx-9" });
    // Nothing was written: the row is the truth and it stays.
    expect(mockPrisma.subscriptionCharge.update).not.toHaveBeenCalled();
  });

  it("lets a genuine decline be retried for the same period", async () => {
    mockPrisma.subscriptionCharge.create.mockRejectedValue(dup());
    mockPrisma.subscriptionCharge.findUniqueOrThrow.mockResolvedValue(row("failed"));
    expect(await claimChargeForPeriod("biz", "2026-09-15", 374.9)).toEqual({ kind: "new" });
    expect(mockPrisma.subscriptionCharge.update.mock.calls[0][0].data.status).toBe("pending");
  });

  it("stands aside for a pending row written seconds ago — another run is mid-charge", async () => {
    mockPrisma.subscriptionCharge.create.mockRejectedValue(dup());
    mockPrisma.subscriptionCharge.findUniqueOrThrow.mockResolvedValue(row("pending", 30_000));
    expect(await claimChargeForPeriod("biz", "2026-09-15", 374.9)).toEqual({ kind: "in-flight" });
  });

  it("refuses to charge behind a pending row that is old enough to be a dead run, and parks it", async () => {
    mockPrisma.subscriptionCharge.create.mockRejectedValue(dup());
    mockPrisma.subscriptionCharge.findUniqueOrThrow.mockResolvedValue(row("pending", 20 * 60 * 1000));
    expect(await claimChargeForPeriod("biz", "2026-09-15", 374.9)).toEqual({ kind: "unknown" });
    // Parked, so the next hourly run does not report it again.
    expect(mockPrisma.subscriptionCharge.update.mock.calls[0][0].data.status).toBe("unknown");
  });

  it("stays parked once reported, until a person resolves the row", async () => {
    mockPrisma.subscriptionCharge.create.mockRejectedValue(dup());
    mockPrisma.subscriptionCharge.findUniqueOrThrow.mockResolvedValue(row("unknown", 3 * 60 * 60 * 1000));
    expect(await claimChargeForPeriod("biz", "2026-09-15", 374.9)).toEqual({ kind: "in-flight" });
  });

  it("propagates a database failure that is not the unique index — that is an outage, not a claim", async () => {
    mockPrisma.subscriptionCharge.create.mockRejectedValue(new Error("connection refused"));
    await expect(claimChargeForPeriod("biz", "2026-09-15", 374.9)).rejects.toThrow("connection refused");
  });
});

describe("recordChargeOutcome", () => {
  it("settles a success with its transaction id", async () => {
    await recordChargeOutcome("biz", "2026-09-15", { success: true, transactionId: "tx-1" });
    expect(mockPrisma.subscriptionCharge.update.mock.calls[0][0].data).toEqual({ status: "charged", transactionId: "tx-1", error: null });
  });

  it("settles a decline as failed, keeping the reason", async () => {
    await recordChargeOutcome("biz", "2026-09-15", { success: false, error: "declined" });
    expect(mockPrisma.subscriptionCharge.update.mock.calls[0][0].data).toEqual({ status: "failed", error: "declined" });
  });
});

describe("periodKeyFor", () => {
  it("is the due date as a UTC day, so a DST change cannot split one period into two keys", () => {
    expect(periodKeyFor(new Date("2026-10-25T00:30:00.000Z"), new Date())).toBe("2026-10-25");
  });
  it("falls back to today when a business has no due date on record", () => {
    expect(periodKeyFor(null, new Date("2026-09-15T12:00:00.000Z"))).toBe("2026-09-15");
  });
});
