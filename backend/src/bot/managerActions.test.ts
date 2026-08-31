import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  appointment: { findMany: vi.fn(), count: vi.fn() },
  customer: { count: vi.fn() },
  blockedTime: { create: vi.fn() },
  business: { findUnique: vi.fn() },
};
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/crypto.js", () => ({ decryptSecret: (s: string) => s }));
vi.mock("../lib/errorMonitoring.js", () => ({ captureError: vi.fn() }));
const sendWhatsAppMessage = vi.fn();
vi.mock("../webhook/whatsappClient.js", () => ({
  sendWhatsAppMessage: (...a: unknown[]) => sendWhatsAppMessage(...a),
}));

const { daySchedule, businessSummary, blockTime, notifyCustomerOfCancellation, BlockOverlapError, todayIn } =
  await import("./managerActions.js");

const TZ = "Asia/Jerusalem";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.appointment.findMany.mockResolvedValue([]);
  mockPrisma.appointment.count.mockResolvedValue(0);
  mockPrisma.customer.count.mockResolvedValue(0);
  mockPrisma.blockedTime.create.mockResolvedValue({ id: "bt1" });
  sendWhatsAppMessage.mockResolvedValue(undefined);
});

describe("daySchedule", () => {
  it("includes unpaid holds as well as confirmed bookings", async () => {
    // A held slot is not free. Hiding it would show the owner time they cannot actually sell.
    await daySchedule("b1", "2026-09-01", TZ);
    const where = mockPrisma.appointment.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["confirmed", "pending_payment"] });
  });

  it("returns entries in the order they happen, with the local time", async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([
      {
        id: "a1",
        startTime: new Date("2026-09-01T06:30:00Z"), // 09:30 in Jerusalem
        status: "confirmed",
        customer: { name: "דנה", phone: "972501111111" },
        service: { name: "תספורת" },
        staff: null,
      },
    ]);

    const out = await daySchedule("b1", "2026-09-01", TZ);

    expect(out[0]).toMatchObject({ time: "09:30", customer: "דנה", service: "תספורת", status: "confirmed" });
  });

  it("falls back to the phone when the customer has no name", async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([
      {
        id: "a1",
        startTime: new Date("2026-09-01T06:30:00Z"),
        status: "confirmed",
        customer: { name: null, phone: "972501111111" },
        service: { name: "תספורת" },
        staff: null,
      },
    ]);

    expect((await daySchedule("b1", "2026-09-01", TZ))[0].customer).toBe("972501111111");
  });
});

describe("businessSummary", () => {
  it("reports revenue net of discounts actually given", async () => {
    // List prices would overstate takings for exactly the businesses running promotions.
    mockPrisma.appointment.findMany.mockResolvedValue([
      { service: { priceCents: 20000 }, couponDiscountIls: 20 },
      { service: { priceCents: 15000 }, couponDiscountIls: null },
    ]);

    const summary = await businessSummary("b1", TZ);

    expect(summary.revenueThisMonthIls).toBe(330); // (200-20) + 150
    expect(summary.confirmedThisMonth).toBe(2);
  });

  it("never reports negative revenue when a discount exceeded the price", async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([{ service: { priceCents: 5000 }, couponDiscountIls: 200 }]);

    expect((await businessSummary("b1", TZ)).revenueThisMonthIls).toBe(0);
  });
});

describe("blockTime", () => {
  const window = {
    businessId: "b1",
    start: new Date("2026-09-01T11:00:00Z"),
    end: new Date("2026-09-01T13:00:00Z"),
    timezone: TZ,
  };

  it("blocks a free window", async () => {
    const result = await blockTime(window);
    expect(result.id).toBe("bt1");
    expect(mockPrisma.blockedTime.create).toHaveBeenCalled();
  });

  it("refuses over existing bookings and names them", async () => {
    // Blocking does not cancel, so the appointment would survive invisibly: the owner believes the
    // time is theirs and the customer turns up.
    mockPrisma.appointment.findMany.mockResolvedValue([
      {
        startTime: new Date("2026-09-01T11:30:00Z"),
        customer: { name: "יוסי", phone: "1" },
        service: { name: "צבע" },
      },
    ]);

    await expect(blockTime(window)).rejects.toBeInstanceOf(BlockOverlapError);
    expect(mockPrisma.blockedTime.create).not.toHaveBeenCalled();
  });

  it("detects a booking that merely overlaps the edge", async () => {
    await blockTime(window);
    const where = mockPrisma.appointment.findMany.mock.calls[0][0].where;
    // Overlap, not containment: a booking straddling the start must count.
    expect(where.startTime).toEqual({ lt: window.end });
    expect(where.endTime).toEqual({ gt: window.start });
  });

  it("writes nothing on a dry run", async () => {
    const result = await blockTime({ ...window, dryRun: true });
    expect(result.id).toBeNull();
    expect(mockPrisma.blockedTime.create).not.toHaveBeenCalled();
  });
});

describe("notifyCustomerOfCancellation", () => {
  const args = { businessId: "b1", customerPhone: "972501111111", serviceName: "תספורת", when: "מחר ב-10:00" };

  it("tells the customer and reports success", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      name: "מספרת רונית",
      whatsappPhoneNumberId: "pn1",
      whatsappAccessToken: "tok",
    });

    expect(await notifyCustomerOfCancellation(args)).toBe(true);
    expect(sendWhatsAppMessage.mock.calls[0][0].text).toContain("תספורת");
  });

  it("reports failure rather than throwing, so the cancellation still stands", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      name: "x",
      whatsappPhoneNumberId: "pn1",
      whatsappAccessToken: "tok",
    });
    sendWhatsAppMessage.mockRejectedValue(new Error("outside 24h window"));

    expect(await notifyCustomerOfCancellation(args)).toBe(false);
  });

  it("reports failure when the business has no WhatsApp connected", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({ name: "x", whatsappPhoneNumberId: null, whatsappAccessToken: null });

    expect(await notifyCustomerOfCancellation(args)).toBe(false);
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });
});

describe("todayIn", () => {
  it("gives the date where the business is, not where the server is", () => {
    // 22:30 UTC is already the next day in Jerusalem — a salon asking for "today" at that moment
    // means the day running there.
    vi.setSystemTime(new Date("2026-09-01T22:30:00Z"));
    expect(todayIn(TZ)).toBe("2026-09-02");
    vi.useRealTimers();
  });
});
