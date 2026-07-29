import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  appointment: { findMany: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
};
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../webhook/whatsappClient.js", () => ({ sendWhatsAppMessage: vi.fn() }));
vi.mock("./crypto.js", () => ({ decryptSecret: (s: string) => s }));

const expiredHold = {
  id: "appt1",
  businessId: "biz1",
  service: { name: "תספורת" },
  customer: { phone: "972500000000" },
  business: { name: "Test", whatsappPhoneNumberId: null, whatsappAccessToken: null },
};

/**
 * The job tracks the next hold expiry in module-level state so it can skip the database on ticks
 * where nothing is due (see depositExpiryJob.ts). That state is deliberately process-global, which
 * means a single shared import would leak it between tests and make them ordering-dependent — so
 * each test takes a freshly-imported module.
 */
async function freshJob() {
  vi.resetModules();
  const mod = await import("./depositExpiryJob.js");
  return mod.runDepositExpiryJob;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: report a hold that is already due, so tests exercising the sweep actually reach it.
  // The job re-seeds after sweeping too, so this has to answer every call, not just the first.
  mockPrisma.appointment.findFirst.mockResolvedValue({ depositExpiresAt: new Date(Date.now() - 60_000) });
});

describe("runDepositExpiryJob", () => {
  it("cancels a hold whose deposit window passed unpaid", async () => {
    const runDepositExpiryJob = await freshJob();
    mockPrisma.appointment.findMany.mockResolvedValue([expiredHold]);
    mockPrisma.appointment.updateMany.mockResolvedValue({ count: 1 });

    await runDepositExpiryJob();

    expect(mockPrisma.appointment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "cancelled", depositStatus: "none" } })
    );
  });

  it("guards the cancel on the row still being an unpaid hold, so a payment that lands mid-run wins", async () => {
    const runDepositExpiryJob = await freshJob();
    mockPrisma.appointment.findMany.mockResolvedValue([expiredHold]);
    mockPrisma.appointment.updateMany.mockResolvedValue({ count: 0 }); // webhook confirmed it first

    await runDepositExpiryJob();

    // The status/depositStatus guard must be part of the WHERE clause — updating by id alone
    // would cancel an appointment the customer already paid for.
    expect(mockPrisma.appointment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "appt1", status: "pending_payment", depositStatus: "pending" }),
      })
    );
  });

  // The point of the in-memory next-expiry tracking: this job ticks every 5 minutes forever, and a
  // query on every tick kept managed Postgres from ever suspending its compute, which burned a
  // whole monthly compute allowance by mid-month. With no hold outstanding it must not sweep.
  it("does not sweep when nothing is pending, so the database can stay idle", async () => {
    const runDepositExpiryJob = await freshJob();
    mockPrisma.appointment.findFirst.mockResolvedValue(null);

    await runDepositExpiryJob();

    expect(mockPrisma.appointment.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.appointment.updateMany).not.toHaveBeenCalled();
  });

  it("does not sweep while the earliest hold is still in the future", async () => {
    const runDepositExpiryJob = await freshJob();
    mockPrisma.appointment.findFirst.mockResolvedValue({ depositExpiresAt: new Date(Date.now() + 20 * 60_000) });

    await runDepositExpiryJob();

    expect(mockPrisma.appointment.findMany).not.toHaveBeenCalled();
  });

  // Once seeded, later ticks must decide from memory alone — re-querying every tick would
  // reintroduce exactly the wake-up this state exists to avoid.
  it("only seeds from the database once while nothing is pending", async () => {
    const runDepositExpiryJob = await freshJob();
    mockPrisma.appointment.findFirst.mockResolvedValue(null);

    await runDepositExpiryJob();
    await runDepositExpiryJob();
    await runDepositExpiryJob();

    expect(mockPrisma.appointment.findFirst).toHaveBeenCalledTimes(1);
  });
});
