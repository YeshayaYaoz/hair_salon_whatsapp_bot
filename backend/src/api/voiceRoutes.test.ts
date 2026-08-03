import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const mockPrisma = {
  business: { findMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  businessHours: { findMany: vi.fn() },
  customer: { findMany: vi.fn() },
  appointment: { findFirst: vi.fn() },
  service: { findFirst: vi.fn(), findMany: vi.fn() },
  staffMember: { findFirst: vi.fn(), findMany: vi.fn() },
  faqEntry: { findMany: vi.fn() },
  specialPeriod: { findMany: vi.fn() },
};

const mockFindAvailableSlots = vi.fn();
const mockBookAppointmentWithSideEffects = vi.fn();
const mockCancelAppointmentById = vi.fn();
const mockRescheduleAppointmentById = vi.fn();

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../booking/availability.js", async () => {
  const actual = await vi.importActual<typeof import("../booking/availability.js")>("../booking/availability.js");
  return { ...actual, findAvailableSlots: mockFindAvailableSlots };
});
vi.mock("../booking/actions.js", async () => {
  const actual = await vi.importActual<typeof import("../booking/actions.js")>("../booking/actions.js");
  return {
    ...actual,
    bookAppointmentWithSideEffects: mockBookAppointmentWithSideEffects,
    cancelAppointmentById: mockCancelAppointmentById,
    rescheduleAppointmentById: mockRescheduleAppointmentById,
  };
});

describe("POST /api/voice/context", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.CARTESIA_TOOL_SECRET = "test-secret";
    const { voiceRouter } = await import("./voiceRoutes.js");
    app = express();
    app.use(express.json());
    app.use("/api/voice", voiceRouter);
  });

  it("rejects requests without the shared secret", async () => {
    const res = await request(app).post("/api/voice/context").send({ calledNumber: "+972501111111", callerNumber: "+972502222222" });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong secret", async () => {
    const res = await request(app)
      .post("/api/voice/context")
      .set("Authorization", "Bearer wrong")
      .send({ calledNumber: "+972501111111", callerNumber: "+972502222222" });
    expect(res.status).toBe(401);
  });

  it("404s when no business has that voice number configured", async () => {
    mockPrisma.business.findMany.mockResolvedValue([]);
    const res = await request(app)
      .post("/api/voice/context")
      .set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "+972501111111", callerNumber: "+972502222222" });
    expect(res.status).toBe(404);
  });

  it("matches the called number regardless of a leading + or formatting differences", async () => {
    mockPrisma.business.findMany.mockResolvedValue([{ id: "biz1", voicePhoneNumber: "972501111111" }]);
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ name: "Salon Dana", timezone: "Asia/Jerusalem", address: null, botGreeting: null });
    mockPrisma.businessHours.findMany.mockResolvedValue([]);
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.service.findMany.mockResolvedValue([]);
    mockPrisma.faqEntry.findMany.mockResolvedValue([]);
    mockPrisma.specialPeriod.findMany.mockResolvedValue([]);

    const res = await request(app)
      .post("/api/voice/context")
      .set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "+972-50-111-1111", callerNumber: "+972502222222" });

    expect(res.status).toBe(200);
    expect(res.body.businessName).toBe("Salon Dana");
    expect(res.body.caller.isKnownCustomer).toBe(false);
  });

  it("surfaces a known caller's upcoming appointment", async () => {
    mockPrisma.business.findMany.mockResolvedValue([{ id: "biz1", voicePhoneNumber: "972501111111" }]);
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ name: "Salon Dana", timezone: "Asia/Jerusalem", address: null, botGreeting: null });
    mockPrisma.businessHours.findMany.mockResolvedValue([]);
    mockPrisma.customer.findMany.mockResolvedValue([{ id: "cust1", phone: "972502222222", name: "Yael" }]);
    mockPrisma.service.findMany.mockResolvedValue([]);
    mockPrisma.faqEntry.findMany.mockResolvedValue([]);
    mockPrisma.specialPeriod.findMany.mockResolvedValue([]);
    mockPrisma.appointment.findFirst.mockResolvedValue({
      id: "appt1",
      startTime: new Date("2026-08-01T10:00:00Z"),
      service: { name: "Haircut" },
      staff: { name: "Dana" },
    });

    const res = await request(app)
      .post("/api/voice/context")
      .set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "972501111111", callerNumber: "972502222222" });

    expect(res.status).toBe(200);
    expect(res.body.caller).toEqual({
      isKnownCustomer: true,
      name: "Yael",
      upcomingAppointment: { id: "appt1", serviceName: "Haircut", startTime: "2026-08-01T10:00:00.000Z", staffName: "Dana" },
    });
  });

  it("includes the fields the agent is asked about: capacity, directions and pricing rules", async () => {
    mockPrisma.business.findMany.mockResolvedValue([{ id: "biz1", voicePhoneNumber: "972501111111" }]);
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({
      name: "Tzimmer",
      timezone: "Asia/Jerusalem",
      address: "מושב כלשהו",
      botGreeting: null,
      googleMapsUrl: "https://maps.app.goo.gl/abc",
      pricingNotes: "סופ״ש מינימום שני לילות",
    });
    mockPrisma.businessHours.findMany.mockResolvedValue([]);
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.service.findMany.mockResolvedValue([
      { name: 'צימר "תאנה"', description: null, priceCents: 90000, durationMin: 1440, capacity: 4 },
    ]);
    mockPrisma.faqEntry.findMany.mockResolvedValue([]);
    mockPrisma.specialPeriod.findMany.mockResolvedValue([]);

    const res = await request(app)
      .post("/api/voice/context")
      .set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "972501111111", callerNumber: "972509999999" });

    expect(res.status).toBe(200);
    // How many guests a unit sleeps is the most common question on a booking call.
    expect(res.body.services[0].capacity).toBe(4);
    expect(res.body.googleMapsUrl).toBe("https://maps.app.goo.gl/abc");
    expect(res.body.pricingNotes).toBe("סופ״ש מינימום שני לילות");
  });

  it("returns upcoming special periods as plain calendar dates", async () => {
    mockPrisma.business.findMany.mockResolvedValue([{ id: "biz1", voicePhoneNumber: "972501111111" }]);
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ name: "Tzimmer", timezone: "Asia/Jerusalem", address: null, botGreeting: null });
    mockPrisma.businessHours.findMany.mockResolvedValue([]);
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.service.findMany.mockResolvedValue([]);
    mockPrisma.faqEntry.findMany.mockResolvedValue([]);
    mockPrisma.specialPeriod.findMany.mockResolvedValue([
      {
        label: "ערב פסח",
        description: "מחיר כפול",
        startDate: new Date("2027-04-21T00:00:00Z"),
        endDate: new Date("2027-04-21T00:00:00Z"),
      },
    ]);

    const res = await request(app)
      .post("/api/voice/context")
      .set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "972501111111", callerNumber: "972509999999" });

    expect(res.status).toBe(200);
    // Dates the agent reads aloud must be plain days, not timestamps.
    expect(res.body.specialPeriods).toEqual([
      { label: "ערב פסח", description: "מחיר כפול", startDate: "2027-04-21", endDate: "2027-04-21" },
    ]);
    // Periods that already ended must not be fetched at all — the filter is the query's job.
    const where = mockPrisma.specialPeriod.findMany.mock.calls[0][0].where;
    expect(where.businessId).toBe("biz1");
    expect(where.endDate.gte).toBeInstanceOf(Date);
  });
});

describe("POST /api/voice/check-availability", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.CARTESIA_TOOL_SECRET = "test-secret";
    const { voiceRouter } = await import("./voiceRoutes.js");
    app = express();
    app.use(express.json());
    app.use("/api/voice", voiceRouter);
  });

  it("404s for an unknown service and lists the real ones", async () => {
    mockPrisma.business.findMany.mockResolvedValue([{ id: "biz1", voicePhoneNumber: "972501111111", timezone: "Asia/Jerusalem" }]);
    mockPrisma.service.findFirst.mockResolvedValue(null);
    mockPrisma.service.findMany.mockResolvedValue([{ name: "Haircut" }]);

    const res = await request(app)
      .post("/api/voice/check-availability")
      .set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "972501111111", serviceName: "Massage", date: "2026-08-01" });

    expect(res.status).toBe(404);
    expect(res.body.availableServices).toEqual(["Haircut"]);
  });

  it("returns slots with a formatted local time", async () => {
    mockPrisma.business.findMany.mockResolvedValue([{ id: "biz1", voicePhoneNumber: "972501111111", timezone: "Asia/Jerusalem" }]);
    mockPrisma.service.findFirst.mockResolvedValue({ id: "svc1", durationMin: 30 });
    mockFindAvailableSlots.mockResolvedValue([{ startTime: "2026-08-01T10:00:00.000Z", endTime: "2026-08-01T10:30:00.000Z", staffId: null }]);

    const res = await request(app)
      .post("/api/voice/check-availability")
      .set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "972501111111", serviceName: "Haircut", date: "2026-08-01" });

    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([{ startTime: "2026-08-01T10:00:00.000Z", localTime: "13:00", staffId: null }]);
  });
});

describe("POST /api/voice/book", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.CARTESIA_TOOL_SECRET = "test-secret";
    const { voiceRouter } = await import("./voiceRoutes.js");
    app = express();
    app.use(express.json());
    app.use("/api/voice", voiceRouter);
  });

  it("books and returns the appointment id", async () => {
    mockPrisma.business.findMany.mockResolvedValue([{ id: "biz1", voicePhoneNumber: "972501111111", timezone: "Asia/Jerusalem" }]);
    mockPrisma.service.findFirst.mockResolvedValue({ id: "svc1", name: "Haircut" });
    mockBookAppointmentWithSideEffects.mockResolvedValue({
      id: "appt1",
      startTime: new Date("2026-08-01T10:00:00Z"),
      endTime: new Date("2026-08-01T10:30:00Z"),
    });

    const res = await request(app)
      .post("/api/voice/book")
      .set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "972501111111", callerNumber: "972502222222", serviceName: "Haircut", startTime: "2026-08-01T10:00:00Z" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      booked: true,
      appointmentId: "appt1",
      startTime: "2026-08-01T10:00:00.000Z",
      endTime: "2026-08-01T10:30:00.000Z",
    });
  });

  it("returns 409 when the slot was taken concurrently", async () => {
    mockPrisma.business.findMany.mockResolvedValue([{ id: "biz1", voicePhoneNumber: "972501111111", timezone: "Asia/Jerusalem" }]);
    mockPrisma.service.findFirst.mockResolvedValue({ id: "svc1", name: "Haircut" });
    const { SlotUnavailableError } = await import("../booking/availability.js");
    mockBookAppointmentWithSideEffects.mockRejectedValue(new SlotUnavailableError());

    const res = await request(app)
      .post("/api/voice/book")
      .set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "972501111111", callerNumber: "972502222222", serviceName: "Haircut", startTime: "2026-08-01T10:00:00Z" });

    expect(res.status).toBe(409);
  });
});

describe("POST /api/voice/cancel", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.CARTESIA_TOOL_SECRET = "test-secret";
    const { voiceRouter } = await import("./voiceRoutes.js");
    app = express();
    app.use(express.json());
    app.use("/api/voice", voiceRouter);
  });

  it("cancels a matched appointment", async () => {
    mockPrisma.business.findMany.mockResolvedValue([{ id: "biz1", voicePhoneNumber: "972501111111", timezone: "Asia/Jerusalem" }]);
    mockCancelAppointmentById.mockResolvedValue(undefined);

    const res = await request(app)
      .post("/api/voice/cancel")
      .set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "972501111111", appointmentId: "appt1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cancelled: true });
    expect(mockCancelAppointmentById).toHaveBeenCalledWith("biz1", "appt1");
  });

  it("404s when the appointment doesn't belong to this business", async () => {
    mockPrisma.business.findMany.mockResolvedValue([{ id: "biz1", voicePhoneNumber: "972501111111", timezone: "Asia/Jerusalem" }]);
    const { AppointmentNotFoundError } = await import("../booking/actions.js");
    mockCancelAppointmentById.mockRejectedValue(new AppointmentNotFoundError());

    const res = await request(app)
      .post("/api/voice/cancel")
      .set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "972501111111", appointmentId: "someone-elses-appt" });

    expect(res.status).toBe(404);
  });
});

describe("POST /api/voice/reschedule", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.CARTESIA_TOOL_SECRET = "test-secret";
    const { voiceRouter } = await import("./voiceRoutes.js");
    app = express();
    app.use(express.json());
    app.use("/api/voice", voiceRouter);
  });

  it("reschedules to the new time", async () => {
    mockPrisma.business.findMany.mockResolvedValue([{ id: "biz1", voicePhoneNumber: "972501111111", timezone: "Asia/Jerusalem" }]);
    mockRescheduleAppointmentById.mockResolvedValue({
      startTime: new Date("2026-08-02T10:00:00Z"),
      endTime: new Date("2026-08-02T10:30:00Z"),
    });

    const res = await request(app)
      .post("/api/voice/reschedule")
      .set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "972501111111", appointmentId: "appt1", newStartTime: "2026-08-02T10:00:00Z" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rescheduled: true, startTime: "2026-08-02T10:00:00.000Z", endTime: "2026-08-02T10:30:00.000Z" });
  });

  it("keeps the original on a slot conflict", async () => {
    mockPrisma.business.findMany.mockResolvedValue([{ id: "biz1", voicePhoneNumber: "972501111111", timezone: "Asia/Jerusalem" }]);
    const { SlotUnavailableError } = await import("../booking/availability.js");
    mockRescheduleAppointmentById.mockRejectedValue(new SlotUnavailableError());

    const res = await request(app)
      .post("/api/voice/reschedule")
      .set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "972501111111", appointmentId: "appt1", newStartTime: "2026-08-02T10:00:00Z" });

    expect(res.status).toBe(409);
  });
});
