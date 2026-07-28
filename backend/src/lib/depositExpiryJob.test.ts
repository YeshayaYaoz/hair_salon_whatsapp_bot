import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  appointment: { findMany: vi.fn(), updateMany: vi.fn() },
};
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../webhook/whatsappClient.js", () => ({ sendWhatsAppMessage: vi.fn() }));
vi.mock("./crypto.js", () => ({ decryptSecret: (s: string) => s }));

const { runDepositExpiryJob } = await import("./depositExpiryJob.js");

const expiredHold = {
  id: "appt1",
  businessId: "biz1",
  service: { name: "תספורת" },
  customer: { phone: "972500000000" },
  business: { name: "Test", whatsappPhoneNumberId: null, whatsappAccessToken: null },
};

beforeEach(() => vi.clearAllMocks());

describe("runDepositExpiryJob", () => {
  it("cancels a hold whose deposit window passed unpaid", async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([expiredHold]);
    mockPrisma.appointment.updateMany.mockResolvedValue({ count: 1 });

    await runDepositExpiryJob();

    expect(mockPrisma.appointment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "cancelled", depositStatus: "none" } })
    );
  });

  it("guards the cancel on the row still being an unpaid hold, so a payment that lands mid-run wins", async () => {
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
});
