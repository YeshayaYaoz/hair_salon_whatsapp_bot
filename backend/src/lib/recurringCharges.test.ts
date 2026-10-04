import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The monthly loop: a due appears on the charge's day, once; the owner is told; a receipt is issued
 * only on confirmation, and only marked received once the provider actually issued it.
 */
const mockPrisma = {
  business: { findMany: vi.fn() },
  chargeDue: { create: vi.fn(), count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
};
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
const notifyOwner = vi.fn();
vi.mock("./ownerNotify.js", () => ({ notifyOwner: (...a: unknown[]) => notifyOwner(...a) }));
const issueAndSendReceipt = vi.fn();
vi.mock("./receipts.js", async () => {
  const actual = await vi.importActual<typeof import("./receipts.js")>("./receipts.js");
  return { ...actual, issueAndSendReceipt: (...a: unknown[]) => issueAndSendReceipt(...a) };
});
vi.mock("./errorMonitoring.js", () => ({ captureError: vi.fn() }));

const { runRecurringChargesJob, confirmChargeDue, skipChargeDue } = await import("./recurringCharges.js");
const { NoInvoiceProviderError } = await import("./receipts.js");

const charge = (over: Partial<{ id: string; dayOfMonth: number; amountIls: number }> = {}) => ({
  id: "rc1", customerId: "c1", amountIls: 350, description: "מנוי חודשי", dayOfMonth: 1, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockPrisma.chargeDue.create.mockResolvedValue({});
  mockPrisma.chargeDue.count.mockResolvedValue(1);
});

describe("creating the month's dues", () => {
  it("creates a due on the charge's day, in the business's own timezone, and tells the owner", async () => {
    // 1st of the month at 22:30 UTC — already the 2nd in Jerusalem? No: 00:30 on the 2nd. Use a
    // time that is still the 1st in Jerusalem (UTC+3 in October): 20:00 UTC on Oct 1.
    vi.setSystemTime(new Date("2026-10-01T20:00:00Z"));
    mockPrisma.business.findMany.mockResolvedValue([{ id: "b1", timezone: "Asia/Jerusalem", recurringCharges: [charge()] }]);

    await runRecurringChargesJob();

    expect(mockPrisma.chargeDue.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.chargeDue.create.mock.calls[0][0].data).toMatchObject({ businessId: "b1", recurringChargeId: "rc1", amountIls: 350 });
    expect(notifyOwner).toHaveBeenCalledTimes(1);
    expect(notifyOwner.mock.calls[0][1]).toMatch(/₪350/);
  });

  it("creates nothing on another day", async () => {
    vi.setSystemTime(new Date("2026-10-05T10:00:00Z"));
    mockPrisma.business.findMany.mockResolvedValue([{ id: "b1", timezone: "Asia/Jerusalem", recurringCharges: [charge()] }]);

    await runRecurringChargesJob();

    expect(mockPrisma.chargeDue.create).not.toHaveBeenCalled();
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it("lets a charge on the 31st fall due on the last day of a shorter month", async () => {
    vi.setSystemTime(new Date("2026-11-30T10:00:00Z")); // November has 30 days
    mockPrisma.business.findMany.mockResolvedValue([{ id: "b1", timezone: "Asia/Jerusalem", recurringCharges: [charge({ dayOfMonth: 31 })] }]);

    await runRecurringChargesJob();

    expect(mockPrisma.chargeDue.create).toHaveBeenCalledTimes(1);
  });

  it("is silent on the second run of the day — the due already exists, so no second nudge", async () => {
    vi.setSystemTime(new Date("2026-10-01T10:00:00Z"));
    mockPrisma.business.findMany.mockResolvedValue([{ id: "b1", timezone: "Asia/Jerusalem", recurringCharges: [charge()] }]);
    mockPrisma.chargeDue.create.mockRejectedValue(new Error("Unique constraint failed on the fields: (`recurringChargeId`,`dueDate`)"));

    await runRecurringChargesJob();

    expect(notifyOwner).not.toHaveBeenCalled();
  });
});

describe("confirming a due", () => {
  const pendingDue = { id: "d1", status: "pending", amountIls: 350, description: "מנוי חודשי", customer: { id: "c1", name: "דנה כהן", phone: "972501111111" } };

  it("issues the receipt for the customer and only then marks the due received", async () => {
    mockPrisma.chargeDue.findFirst.mockResolvedValue(pendingDue);
    issueAndSendReceipt.mockResolvedValue({ receiptId: "r1", documentUrl: "https://doc", delivery: "template" });

    const out = await confirmChargeDue("b1", "d1");

    expect(out.ok).toBe(true);
    expect(issueAndSendReceipt.mock.calls[0][0]).toMatchObject({ businessId: "b1", amountIls: 350, customerId: "c1", chargeDueId: "d1", customerPhone: "972501111111" });
    expect(mockPrisma.chargeDue.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: expect.objectContaining({ status: "received" }) });
  });

  it("leaves the due pending when the provider fails — nothing was issued", async () => {
    mockPrisma.chargeDue.findFirst.mockResolvedValue(pendingDue);
    issueAndSendReceipt.mockRejectedValue(new Error("502 from provider"));

    const out = await confirmChargeDue("b1", "d1");

    expect(out.ok).toBe(false);
    expect(mockPrisma.chargeDue.update).not.toHaveBeenCalled();
  });

  it("says what to do when no invoicing provider is connected", async () => {
    mockPrisma.chargeDue.findFirst.mockResolvedValue(pendingDue);
    issueAndSendReceipt.mockRejectedValue(new NoInvoiceProviderError());

    const out = await confirmChargeDue("b1", "d1");

    expect(out).toMatchObject({ ok: false, code: "no_provider" });
  });

  it("refuses to confirm the same due twice — one payment, one receipt", async () => {
    mockPrisma.chargeDue.findFirst.mockResolvedValue({ ...pendingDue, status: "received" });
    const out = await confirmChargeDue("b1", "d1");
    expect(out).toMatchObject({ ok: false, code: "already" });
    expect(issueAndSendReceipt).not.toHaveBeenCalled();
  });

  it("cannot reach another business's due", async () => {
    mockPrisma.chargeDue.findFirst.mockResolvedValue(null);
    const out = await confirmChargeDue("b2", "d1");
    expect(out).toMatchObject({ ok: false, code: "not_found" });
    expect(mockPrisma.chargeDue.findFirst.mock.calls[0][0].where).toEqual({ id: "d1", businessId: "b2" });
  });

  it("skips only a pending due", async () => {
    mockPrisma.chargeDue.updateMany.mockResolvedValue({ count: 0 });
    expect(await skipChargeDue("b1", "d1")).toBe(false);
    expect(mockPrisma.chargeDue.updateMany.mock.calls[0][0].where).toMatchObject({ status: "pending" });
  });
});
