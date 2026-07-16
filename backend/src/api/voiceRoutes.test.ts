import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const mockPrisma = {
  business: { findMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  businessHours: { findMany: vi.fn() },
  customer: { findMany: vi.fn() },
  appointment: { findFirst: vi.fn() },
};

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

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
    mockPrisma.appointment.findFirst.mockResolvedValue({
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
      upcomingAppointment: { serviceName: "Haircut", startTime: "2026-08-01T10:00:00.000Z", staffName: "Dana" },
    });
  });
});
