import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  business: { findUniqueOrThrow: vi.fn() },
  appointment: { findFirst: vi.fn(), update: vi.fn() },
  // Cancelling releases any customer coupon the booking used. Stubbed to "no redemption" so these
  // tests exercise the real path rather than passing on a swallowed error.
  customerCouponRedemption: { findFirst: vi.fn().mockResolvedValue(null) },
  customerCoupon: { updateMany: vi.fn() },
  $transaction: vi.fn(),
};
const mockNotifyOwner = vi.fn();
const mockNotifyWaitlist = vi.fn();
const mockDeleteCalendarEvent = vi.fn();

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/ownerNotify.js", () => ({ notifyOwner: mockNotifyOwner }));
vi.mock("../lib/waitlist.js", () => ({ notifyWaitlist: mockNotifyWaitlist, waitlistOfferText: () => "" }));
vi.mock("../lib/googleCalendar.js", () => ({
  syncAppointmentToCalendar: vi.fn().mockResolvedValue(null),
  deleteCalendarEvent: mockDeleteCalendarEvent,
}));

const { runTool } = await import("./claudeBot.js");

const SLOTS = { value: undefined };
const PHOTOS = { value: undefined };
const call = (name: string, input: Record<string, unknown> = {}) =>
  runTool("biz1", "972501234567", name, input, SLOTS, PHOTOS).then((r) => JSON.parse(r));

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: "appt1",
    serviceId: "svc1",
    startTime: new Date("2026-08-12T09:00:00Z"),
    calendarEventId: null,
    depositStatus: null,
    depositAmountIls: null,
    depositPaymentUrl: null,
    depositExpiresAt: null,
    service: { name: "תספורת אישה" },
    customer: { name: "דנה", phone: "972501234567" },
    ...overrides,
  };
}

describe("cancel_appointment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ timezone: "Asia/Jerusalem" });
    mockPrisma.appointment.update.mockResolvedValue({});
    mockNotifyWaitlist.mockResolvedValue(undefined);
  });

  it("tells the owner a booking was cancelled", async () => {
    // The owner is told when a booking is made and when a deposit lands, but nothing told them it
    // had been cancelled — so a salon learned its 3pm was free only by looking at the dashboard.
    mockPrisma.appointment.findFirst.mockResolvedValue(appointment());

    const res = await call("cancel_appointment", { startTime: "2026-08-12T09:00:00Z" });

    expect(res.cancelled).toBe(true);
    expect(mockNotifyOwner).toHaveBeenCalledOnce();
    const [, message] = mockNotifyOwner.mock.calls[0];
    expect(message).toContain("בוטל");
    expect(message).toContain("דנה");
    expect(message).toContain("תספורת אישה");
  });

  it("flags a paid deposit to both the owner and the reply", async () => {
    // Money already taken is the owner's decision to make, and the customer must not be left
    // guessing whether their ₪100 vanished.
    mockPrisma.appointment.findFirst.mockResolvedValue(
      appointment({ depositStatus: "paid", depositAmountIls: 100 })
    );

    const res = await call("cancel_appointment", { startTime: "2026-08-12T09:00:00Z" });

    expect(res.depositPaid).toBe(true);
    expect(res.depositAmountIls).toBe(100);
    // The bot has no way to issue a refund and the policy is the salon's, so it must not promise one.
    expect(res.refundGuidance).toMatch(/do NOT promise a refund/i);

    const [, message] = mockNotifyOwner.mock.calls[0];
    expect(message).toContain("100");
    expect(message).toContain("מקדמה");
  });

  it("says nothing about deposits when none was paid", async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(appointment({ depositStatus: "pending" }));

    const res = await call("cancel_appointment", { startTime: "2026-08-12T09:00:00Z" });

    expect(res.depositPaid).toBeUndefined();
    const [, message] = mockNotifyOwner.mock.calls[0];
    expect(message).not.toContain("מקדמה");
  });

  it("still frees the slot for the waitlist", async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(appointment());
    await call("cancel_appointment", { startTime: "2026-08-12T09:00:00Z" });
    expect(mockNotifyWaitlist).toHaveBeenCalledOnce();
  });
});

/**
 * "Can I pay?" had no tool behind it. The model's only option was book_appointment, which finds the
 * slot already held and answers as if something went wrong — a real customer typed "אפשר לשלם?"
 * right after booking and was told their slot had just been taken.
 */
describe("get_payment_link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ timezone: "Asia/Jerusalem" });
  });

  it("returns the link already issued for the held slot", async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(
      appointment({
        depositStatus: "pending",
        depositAmountIls: 100,
        depositPaymentUrl: "https://pay.example/abc",
        depositExpiresAt: new Date("2026-08-12T08:30:00Z"),
      })
    );

    const res = await call("get_payment_link");

    expect(res.paymentUrl).toBe("https://pay.example/abc");
    expect(res.depositAmountIls).toBe(100);
    expect(res.serviceName).toBe("תספורת אישה");
    // The hold is what expires, so the deadline is the useful half of the answer.
    expect(res.expiresAt).toBeTruthy();
  });

  it("does not mint a second link", async () => {
    // Two live payment pages for one slot is how a customer pays twice.
    mockPrisma.appointment.findFirst.mockResolvedValue(
      appointment({ depositStatus: "pending", depositPaymentUrl: "https://pay.example/abc" })
    );

    await call("get_payment_link");

    expect(mockPrisma.appointment.update).not.toHaveBeenCalled();
  });

  it("sends the model to check the facts when there is nothing awaiting payment", async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(null);

    const res = await call("get_payment_link");

    expect(res.paymentUrl).toBeUndefined();
    expect(res.error).toMatch(/list_my_appointments/);
  });

  it("refuses to invent a link when the hold has none", async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(appointment({ depositStatus: "pending" }));

    const res = await call("get_payment_link");

    expect(res.error).toMatch(/do not invent/i);
    expect(res.error).toMatch(/request_human_followup/);
  });
});
