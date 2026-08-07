import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const mockPrisma = {
  business: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  service: { findFirst: vi.fn() },
  appointment: { update: vi.fn() },
};

const mockCreateAppointment = vi.fn();
const mockNotifyOwner = vi.fn();
const mockSyncCalendar = vi.fn();
const mockCreateDepositLink = vi.fn();
const mockReleaseHold = vi.fn();

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../booking/availability.js", async () => {
  const actual = await vi.importActual<typeof import("../booking/availability.js")>("../booking/availability.js");
  return { ...actual, createAppointment: mockCreateAppointment };
});
vi.mock("../lib/ownerNotify.js", () => ({ notifyOwner: mockNotifyOwner }));
vi.mock("../lib/googleCalendar.js", () => ({ syncAppointmentToCalendar: mockSyncCalendar }));
vi.mock("../booking/deposits.js", async () => {
  const actual = await vi.importActual<typeof import("../booking/deposits.js")>("../booking/deposits.js");
  return { ...actual, createDepositLink: mockCreateDepositLink, releaseHold: mockReleaseHold };
});
vi.mock("../lib/subscriptionGate.js", () => ({ hasActiveSubscription: vi.fn().mockResolvedValue(true) }));

const APPOINTMENT = {
  id: "appt1",
  startTime: new Date("2026-08-02T10:00:00Z"),
  endTime: new Date("2026-08-02T10:30:00Z"),
};

/** A salon with a connected provider and deposits switched on — the state that was being bypassed. */
function depositSalon(overrides: Record<string, unknown> = {}) {
  return {
    name: "Salon Dana",
    timezone: "Asia/Jerusalem",
    depositEnabled: true,
    depositAmountIls: 100,
    depositHoldMinutes: 30,
    paymentProvider: "payplus",
    paymentApiKey: "enc-key",
    paymentApiSecret: "enc-secret",
    paymentPageUid: "uid",
    paymentWebhookSecret: "hook",
    ...overrides,
  };
}

/**
 * The public booking widget used to call createAppointment with no deposit fields at all, and
 * without notifying the owner or syncing the calendar. So a salon that required a deposit over
 * WhatsApp handed out free confirmed slots through the booking link on its own website, and the
 * booking existed nowhere but the dashboard until someone thought to look.
 */
describe("POST /api/public/:businessId/book", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCreateAppointment.mockResolvedValue(APPOINTMENT);
    mockSyncCalendar.mockResolvedValue(null);
    mockPrisma.service.findFirst.mockResolvedValue({ id: "svc1", name: "Haircut" });
    const { publicRouter } = await import("./publicRoutes.js");
    app = express();
    app.use(express.json());
    app.use("/api/public", publicRouter);
  });

  const body = {
    serviceId: "svc1",
    startTime: "2026-08-02T10:00:00Z",
    customerName: "Dana",
    customerPhone: "972501234567",
  };

  it("holds the slot and returns a payment link when the salon requires a deposit", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(depositSalon());
    mockCreateDepositLink.mockResolvedValue("https://pay.example/abc");

    const res = await request(app).post("/api/public/biz1/book").send(body);

    expect(res.status).toBe(201);
    expect(res.body.depositRequired).toBe(true);
    expect(res.body.paymentUrl).toBe("https://pay.example/abc");
    expect(res.body.depositAmountIls).toBe(100);

    // The hold, not a confirmed booking.
    expect(mockCreateAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending_payment", depositAmountIls: 100 })
    );
    // Nothing is announced until the money lands — the deposit webhook does that.
    expect(mockNotifyOwner).not.toHaveBeenCalled();
    expect(mockSyncCalendar).not.toHaveBeenCalled();
  });

  it("releases the hold if the payment link cannot be created", async () => {
    // Otherwise a pending_payment row blocks the slot for the whole hold window with no link to pay.
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(depositSalon());
    mockCreateDepositLink.mockRejectedValue(new Error("provider down"));

    const res = await request(app).post("/api/public/biz1/book").send(body);

    expect(res.status).toBe(502);
    expect(mockReleaseHold).toHaveBeenCalledWith("appt1");
  });

  it("books normally when deposits are off, and tells the owner", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(depositSalon({ depositEnabled: false }));

    const res = await request(app).post("/api/public/biz1/book").send(body);

    expect(res.status).toBe(201);
    expect(res.body.depositRequired).toBeUndefined();
    expect(mockCreateAppointment).toHaveBeenCalledWith(
      expect.not.objectContaining({ status: "pending_payment" })
    );
    expect(mockNotifyOwner).toHaveBeenCalledTimes(1);
    expect(mockSyncCalendar).toHaveBeenCalledTimes(1);
  });

  it("does not demand a deposit when the toggle is on but no provider is connected", async () => {
    // The clinic and aesthetics templates switch depositEnabled on during onboarding, long before
    // anyone connects a provider. Treating that as "deposit required" would block every booking.
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      depositSalon({ paymentProvider: null, paymentApiKey: null, paymentApiSecret: null })
    );

    const res = await request(app).post("/api/public/biz1/book").send(body);

    expect(res.status).toBe(201);
    expect(res.body.depositRequired).toBeUndefined();
    expect(mockCreateDepositLink).not.toHaveBeenCalled();
    expect(mockNotifyOwner).toHaveBeenCalledTimes(1);
  });
});
