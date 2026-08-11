import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { cachedHebrewVoices } from "../lib/cartesiaAdmin.js";

const mockPrisma = {
  business: { findMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  // The caller lookup runs as raw SQL (see findCallerCustomer) — resolve "no match" by default.
  $queryRaw: vi.fn(async () => []),
  businessHours: { findMany: vi.fn() },
  // Registering the caller is fire-and-forget on the live-call path; it must resolve, not return
  // undefined, or the handler would appear to fail for a reason that never happens in production.
  customer: { findMany: vi.fn(), upsert: vi.fn(async () => ({})) },
  appointment: { findFirst: vi.fn() },
  service: { findFirst: vi.fn(), findMany: vi.fn() },
  staffMember: { findFirst: vi.fn(), findMany: vi.fn() },
  faqEntry: { findMany: vi.fn() },
  specialPeriod: { findMany: vi.fn() },
  conversationMessage: { findFirst: vi.fn(), createMany: vi.fn() },
};

const mockFindAvailableSlots = vi.fn();
const mockBookAppointmentWithSideEffects = vi.fn();
const mockCancelAppointmentById = vi.fn();
const mockRescheduleAppointmentById = vi.fn();
const mockLogClaudeUsage = vi.fn();
const mockSendWhatsAppMessage = vi.fn();
const mockSendWhatsAppImage = vi.fn();
const mockSendUnitDetailsEmail = vi.fn();

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/usageLedger.js", () => ({ logClaudeUsage: mockLogClaudeUsage }));
vi.mock("../lib/crypto.js", () => ({ decryptSecret: (s: string) => `dec:${s}` }));
vi.mock("../lib/ownerNotify.js", () => ({ notifyOwner: vi.fn(async () => true) }));
vi.mock("../webhook/whatsappClient.js", () => ({
  sendWhatsAppMessage: mockSendWhatsAppMessage,
  sendWhatsAppImage: mockSendWhatsAppImage,
}));
vi.mock("../lib/email.js", () => ({ sendUnitDetailsEmail: mockSendUnitDetailsEmail }));
// The real one calls Cartesia and caches for an hour; stubbed so the catalogue is per-test.
// Synchronous and cache-only by design: awaiting the catalogue here put a Cartesia round trip
// between a phone being answered and the greeting. See cachedHebrewVoices.
vi.mock("../lib/cartesiaAdmin.js", () => ({ cachedHebrewVoices: vi.fn(() => []), warmVoiceCache: vi.fn() }));
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

/**
 * A business entitled to use voice. Every fixture goes through this so the entitlement fields are
 * present by default and each test states only what it is actually about — and so that adding a new
 * gate later fails loudly in one place instead of across every test in the file.
 */
function voiceBusiness(overrides: Record<string, unknown> = {}) {
  return {
    id: "biz1",
    voicePhoneNumber: "972501111111",
    timezone: "Asia/Jerusalem",
    bookingModel: "slots",
    subscriptionStatus: "active",
    subscriptionPlan: "premium",
    blockedAt: null,
    ...overrides,
  };
}

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

  it("registers the caller as a customer, the way the WhatsApp webhook does", async () => {
    // Phone callers were the one channel that left no trace: the Customers page never learned they
    // existed, so a caller who rang twice was 'unknown' both times.
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ name: "Salon Dana", timezone: "Asia/Jerusalem", address: null, botGreeting: null });
    mockPrisma.businessHours.findMany.mockResolvedValue([]);
    mockPrisma.service.findMany.mockResolvedValue([]);
    mockPrisma.faqEntry.findMany.mockResolvedValue([]);
    mockPrisma.specialPeriod.findMany.mockResolvedValue([]);

    await request(app).post("/api/voice/context").set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "+972501111111", callerNumber: "+972502222222" });

    expect(mockPrisma.customer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { businessId: "biz1", phone: "972502222222" } })
    );
  });

  it("does not register a withheld caller ID as a customer", async () => {
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ name: "Salon Dana", timezone: "Asia/Jerusalem", address: null, botGreeting: null });
    mockPrisma.businessHours.findMany.mockResolvedValue([]);
    mockPrisma.service.findMany.mockResolvedValue([]);
    mockPrisma.faqEntry.findMany.mockResolvedValue([]);
    mockPrisma.specialPeriod.findMany.mockResolvedValue([]);

    await request(app).post("/api/voice/context").set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "+972501111111", callerNumber: "unknown" });

    expect(mockPrisma.customer.upsert).not.toHaveBeenCalled();
  });

  it("matches the called number regardless of a leading + or formatting differences", async () => {
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
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

  // One shared agent answers for every salon, so the voice has to travel per call — otherwise every
  // business sounds identical no matter what its owner picked.
  describe("voice selection", () => {
    function stubContext(businessOverrides: Record<string, unknown>) {
      mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
      mockPrisma.business.findUniqueOrThrow.mockResolvedValue({
        name: "Salon Dana", timezone: "Asia/Jerusalem", address: null, botGreeting: null, ...businessOverrides,
      });
      mockPrisma.businessHours.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.service.findMany.mockResolvedValue([]);
      mockPrisma.faqEntry.findMany.mockResolvedValue([]);
      mockPrisma.specialPeriod.findMany.mockResolvedValue([]);
    }

    const post = () =>
      request(app)
        .post("/api/voice/context")
        .set("Authorization", "Bearer test-secret")
        .send({ calledNumber: "972501111111", callerNumber: "972502222222" });

    it("tells the agent which voice this salon chose", async () => {
      stubContext({ voiceId: "voice_abc" });
      const res = await post();
      expect(res.status).toBe(200);
      expect(res.body.voiceId).toBe("voice_abc");
    });

    it("sends null when the salon never picked one, leaving the agent on its own default", async () => {
      stubContext({ voiceId: null });
      const res = await post();
      expect(res.body.voiceId).toBeNull();
    });

    // "אפשר לדבר עם מישהו?" is the most ordinary thing a caller asks. This used to be sent only for
    // inquiry businesses, so a salon's agent had no number to transfer to and talked past them.
    it.each([["slot"], ["inquiry"]])("gives a %s business somewhere to transfer a caller", async (bookingModel) => {
      stubContext({ bookingModel, notificationPhone: "972500000000" });
      expect((await post()).body.ownerTransferNumber).toBe("972500000000");
    });

    it("sends null when the owner never gave a notification phone", async () => {
      stubContext({ bookingModel: "slot", notificationPhone: null });
      expect((await post()).body.ownerTransferNumber).toBeNull();
    });

    // Hebrew inflects every verb for gender, so the agent has to know which one its own voice is
    // before it can say "אני בודקת" rather than "אני בודק". Derived from Cartesia's catalogue so it
    // cannot drift from the voice actually playing.
    it("tells the agent which gender to speak about itself in", async () => {
      vi.mocked(cachedHebrewVoices).mockReturnValue([
        { id: "voice_abc", name: "Yael", description: null, gender: "feminine", previewUrl: null },
        { id: "voice_xyz", name: "Amir", description: null, gender: "masculine", previewUrl: null },
      ]);
      stubContext({ voiceId: "voice_xyz" });
      expect((await post()).body.voiceGender).toBe("masculine");
    });

    // Unknown voice, no catalogue (no API key), or a gender_neutral voice: all leave the agent on
    // the forms it used before the setting existed, rather than guessing at grammar.
    it.each([
      ["a voice that is not in the catalogue", "voice_missing", [] as const],
      ["a gender_neutral voice", "voice_n", [{ id: "voice_n", gender: "gender_neutral" }] as const],
    ])("sends null for %s", async (_label, voiceId, catalogue) => {
      vi.mocked(cachedHebrewVoices).mockReturnValue(
        catalogue.map((v) => ({ name: "V", description: null, previewUrl: null, ...v })) as never
      );
      stubContext({ voiceId });
      expect((await post()).body.voiceGender).toBeNull();
    });
  });

  // Voice is the Premium feature (₪299 against Standard's ₪149) but this router only ever
  // authenticated Cartesia, never the salon — so a Standard business got the whole voice agent by
  // typing a number into a text box, and a cancelled account kept it after its WhatsApp bot had
  // already gone quiet.
  describe("entitlement", () => {
    it("refuses a business on the Standard plan", async () => {
      mockPrisma.business.findMany.mockResolvedValue([voiceBusiness({ subscriptionPlan: "standard" })]);
      const res = await request(app)
        .post("/api/voice/context")
        .set("Authorization", "Bearer test-secret")
        .send({ calledNumber: "972501111111", callerNumber: "972502222222" });
      expect(res.status).toBe(402);
    });

    it("refuses a lapsed subscription", async () => {
      mockPrisma.business.findMany.mockResolvedValue([voiceBusiness({ subscriptionStatus: "past_due" })]);
      const res = await request(app)
        .post("/api/voice/context")
        .set("Authorization", "Bearer test-secret")
        .send({ calledNumber: "972501111111", callerNumber: "972502222222" });
      expect(res.status).toBe(402);
    });

    it("refuses a blocked business even while its subscription looks active", async () => {
      mockPrisma.business.findMany.mockResolvedValue([voiceBusiness({ blockedAt: new Date("2026-01-01") })]);
      const res = await request(app)
        .post("/api/voice/context")
        .set("Authorization", "Bearer test-secret")
        .send({ calledNumber: "972501111111", callerNumber: "972502222222" });
      expect(res.status).toBe(402);
    });

    it("allows a trial, which has no plan chosen yet", async () => {
      // Otherwise voice could never be evaluated before deciding whether to pay for it.
      mockPrisma.business.findMany.mockResolvedValue([
        voiceBusiness({ subscriptionStatus: "trial", subscriptionPlan: null }),
      ]);
      mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ name: "Salon Dana", timezone: "Asia/Jerusalem", address: null, botGreeting: null });
      mockPrisma.businessHours.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.service.findMany.mockResolvedValue([]);
      mockPrisma.faqEntry.findMany.mockResolvedValue([]);
      mockPrisma.specialPeriod.findMany.mockResolvedValue([]);

      const res = await request(app)
        .post("/api/voice/context")
        .set("Authorization", "Bearer test-secret")
        .send({ calledNumber: "972501111111", callerNumber: "972502222222" });
      expect(res.status).toBe(200);
    });

    it("gates the booking endpoint too, not just /context", async () => {
      mockPrisma.business.findMany.mockResolvedValue([voiceBusiness({ subscriptionPlan: "standard" })]);
      const res = await request(app)
        .post("/api/voice/book")
        .set("Authorization", "Bearer test-secret")
        .send({ calledNumber: "972501111111", callerNumber: "972502222222", serviceName: "Haircut", startTime: "2026-08-02T10:00:00Z", customerName: "Dana" });
      expect(res.status).toBe(402);
      expect(mockBookAppointmentWithSideEffects).not.toHaveBeenCalled();
    });
  });

  it("matches a locally-written number against the E.164 one Cartesia dials", async () => {
    // The trap this guards: the owner types their line the way they say it ("055-507-7941") while
    // Cartesia sends "+972555077941". Digits alone are not equal, so the call used to resolve to no
    // business at all — the agent answering a real caller with no idea whose salon it is, and
    // nothing in the logs suggesting a format problem.
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness({ voicePhoneNumber: "055-507-7941" })]);
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ name: "Salon Dana", timezone: "Asia/Jerusalem", address: null, botGreeting: null });
    mockPrisma.businessHours.findMany.mockResolvedValue([]);
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.service.findMany.mockResolvedValue([]);
    mockPrisma.faqEntry.findMany.mockResolvedValue([]);
    mockPrisma.specialPeriod.findMany.mockResolvedValue([]);

    const res = await request(app)
      .post("/api/voice/context")
      .set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "+972555077941", callerNumber: "+972502222222" });

    expect(res.status).toBe(200);
    expect(res.body.businessName).toBe("Salon Dana");
  });

  it("recognises a caller matched by the SQL last-nine-digits lookup", async () => {
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ name: "Salon Dana", timezone: "Asia/Jerusalem", address: null, botGreeting: null });
    mockPrisma.businessHours.findMany.mockResolvedValue([]);
    // The lookup is one raw query returning at most one row — it used to fetch EVERY customer of
    // the business, on the path where an answered caller is hearing silence.
    mockPrisma.$queryRaw.mockResolvedValue([{ id: "c1", phone: "0502222222", name: "אורי" }]);
    mockPrisma.service.findMany.mockResolvedValue([]);
    mockPrisma.faqEntry.findMany.mockResolvedValue([]);
    mockPrisma.specialPeriod.findMany.mockResolvedValue([]);
    mockPrisma.appointment.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/voice/context")
      .set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "+972501111111", callerNumber: "+972502222222" });

    expect(res.body.caller.isKnownCustomer).toBe(true);
    expect(res.body.caller.name).toBe("אורי");
    // The key the SQL matches on: last nine digits, so 0502222222 and +972502222222 are one line.
    const sql = mockPrisma.$queryRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sql.values).toContain("502222222");
  });

  it("never matches on a withheld caller ID", async () => {
    // "unknown" normalizes to "" — fed to the LIKE-suffix as-is it would match every customer in
    // the table, and the agent would greet the caller by whoever sorted first.
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ name: "Salon Dana", timezone: "Asia/Jerusalem", address: null, botGreeting: null });
    mockPrisma.businessHours.findMany.mockResolvedValue([]);
    mockPrisma.service.findMany.mockResolvedValue([]);
    mockPrisma.faqEntry.findMany.mockResolvedValue([]);
    mockPrisma.specialPeriod.findMany.mockResolvedValue([]);

    const res = await request(app)
      .post("/api/voice/context")
      .set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "+972501111111", callerNumber: "unknown" });

    expect(res.status).toBe(200);
    expect(res.body.caller.isKnownCustomer).toBe(false);
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("surfaces a known caller's upcoming appointment", async () => {
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ name: "Salon Dana", timezone: "Asia/Jerusalem", address: null, botGreeting: null });
    mockPrisma.businessHours.findMany.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockResolvedValue([{ id: "cust1", phone: "972502222222", name: "Yael" }]);
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
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
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
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
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
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
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
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
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
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
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
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
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
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
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
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
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
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
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
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
    const { SlotUnavailableError } = await import("../booking/availability.js");
    mockRescheduleAppointmentById.mockRejectedValue(new SlotUnavailableError());

    const res = await request(app)
      .post("/api/voice/reschedule")
      .set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "972501111111", appointmentId: "appt1", newStartTime: "2026-08-02T10:00:00Z" });

    expect(res.status).toBe(409);
  });
});

/**
 * Voice was the only AI spend with no ledger entry: the agent runs in Cartesia's container and
 * talks to the model directly, so every phone call was free as far as the cost dashboard knew.
 */
describe("POST /api/voice/usage", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.CARTESIA_TOOL_SECRET = "test-secret";
    const { voiceRouter } = await import("./voiceRoutes.js");
    app = express();
    app.use(express.json());
    app.use("/api/voice", voiceRouter);
  });

  const usage = {
    calledNumber: "+972501111111",
    callerNumber: "+972502222222",
    model: "deepseek-chat",
    inputTokens: 500,
    outputTokens: 40,
    cacheReadTokens: 8000,
  };

  it("rejects an unauthenticated report", async () => {
    // The endpoint writes billing rows, so an open one would let anyone inflate a salon's costs.
    expect((await request(app).post("/api/voice/usage").send(usage)).status).toBe(401);
  });

  it("logs usage against the business that owns the dialled number", async () => {
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
    const res = await request(app).post("/api/voice/usage").set("Authorization", "Bearer test-secret").send(usage);
    expect(res.status).toBe(200);
    expect(mockLogClaudeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz1",
        customerPhone: "+972502222222",
        model: "deepseek-chat",
        inputTokens: 500,
        cacheReadTokens: 8000,
      })
    );
  });

  it("carries cache-write tokens through, which Anthropic bills at 1.25x", async () => {
    // The first turn of every call writes the whole system prompt to cache; dropping the field
    // would understate exactly that turn on every single call.
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
    const res = await request(app)
      .post("/api/voice/usage")
      .set("Authorization", "Bearer test-secret")
      .send({ ...usage, model: "claude-haiku-4-5-20251001", cacheCreationTokens: 8500 });
    expect(res.status).toBe(200);
    expect(mockLogClaudeUsage.mock.calls[0][0].cacheCreationTokens).toBe(8500);
  });

  it("still records the spend when the caller withheld their number", async () => {
    // Dropping the row would understate cost for exactly the calls we can say least about.
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
    const { callerNumber, ...withheld } = usage;
    const res = await request(app).post("/api/voice/usage").set("Authorization", "Bearer test-secret").send(withheld);
    expect(res.status).toBe(200);
    expect(mockLogClaudeUsage.mock.calls[0][0].customerPhone).toBe("unknown");
  });

  it("404s for a number no business owns", async () => {
    mockPrisma.business.findMany.mockResolvedValue([]);
    const res = await request(app).post("/api/voice/usage").set("Authorization", "Bearer test-secret").send(usage);
    expect(res.status).toBe(404);
    expect(mockLogClaudeUsage).not.toHaveBeenCalled();
  });
});

/**
 * The request the product exists to automate: a caller asking for pictures used to get a note
 * relayed to the owner, who then did the sending by hand.
 */
describe("POST /api/voice/send-details", () => {
  let app: express.Express;

  const unit = {
    name: "גפן", description: "יחידה משפחתית", priceCents: 210000, maxGuests: 7,
    imageUrls: ["https://img/1.jpg", "https://img/2.jpg", "https://img/3.jpg", "https://img/4.jpg", "https://img/5.jpg"],
    linkUrl: "https://zimmer.example/gefen",
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.CARTESIA_TOOL_SECRET = "test-secret";
    const { voiceRouter } = await import("./voiceRoutes.js");
    app = express();
    app.use(express.json());
    app.use("/api/voice", voiceRouter);

    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
    mockPrisma.service.findFirst.mockResolvedValue(unit);
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({
      name: "בנחת רוח", email: "owner@zimmer.test", whatsappPhoneNumberId: "pn1", whatsappAccessToken: "enc",
    });
  });

  const post = (body: Record<string, unknown>) =>
    request(app).post("/api/voice/send-details").set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "972501111111", serviceName: "גפן", ...body });

  it("sends details and at most four photos to an open WhatsApp window", async () => {
    // Window open = the caller messaged this business recently.
    mockPrisma.conversationMessage.findFirst.mockResolvedValue({ id: "m1" });
    const res = await post({ channel: "whatsapp", callerNumber: "+972533391353" });
    expect(res.status).toBe(200);
    expect(mockSendWhatsAppMessage).toHaveBeenCalledOnce();
    // Four, not five: enough to show the unit, few enough not to flood a phone.
    expect(mockSendWhatsAppImage).toHaveBeenCalledTimes(4);
    // "Messaged", not "called". This same call is being written to ConversationMessage as 'user'
    // turns, so without the channel filter the call would vouch for itself and every caller would
    // look reachable on WhatsApp.
    expect(mockPrisma.conversationMessage.findFirst.mock.calls[0][0].where.channel).toBe("whatsapp");
  });

  it("refuses WhatsApp when the caller has no open window, instead of a send that dies in transit", async () => {
    // Meta accepts free-form sends outside the 24h window and rejects them asynchronously — the
    // agent would promise photos that never arrive, which is the owner-alert bug all over again.
    mockPrisma.conversationMessage.findFirst.mockResolvedValue(null);
    const res = await post({ channel: "whatsapp", callerNumber: "+972500000000" });
    expect(res.status).toBe(409);
    expect(mockSendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("refuses WhatsApp for a withheld caller ID", async () => {
    expect((await post({ channel: "whatsapp", callerNumber: "unknown" })).status).toBe(400);
  });

  it("emails the details with the business as Reply-To", async () => {
    const res = await post({ channel: "email", toEmail: "caller@x.test" });
    expect(res.status).toBe(200);
    expect(mockSendUnitDetailsEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "caller@x.test", replyTo: "owner@zimmer.test", unitName: "גפן" })
    );
  });

  it("404s an unknown unit rather than sending something vague", async () => {
    mockPrisma.service.findFirst.mockResolvedValue(null);
    expect((await post({ channel: "email", toEmail: "caller@x.test" })).status).toBe(404);
  });
});

/**
 * A phone call used to leave nothing behind — no customer row, no transcript. The owner could not
 * answer "who called this morning and what did they want", and the WhatsApp bot had no idea it had
 * already spoken to the same person an hour earlier.
 */
describe("POST /api/voice/transcript", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.CARTESIA_TOOL_SECRET = "test-secret";
    const { voiceRouter } = await import("./voiceRoutes.js");
    app = express();
    app.use(express.json());
    app.use("/api/voice", voiceRouter);
    mockPrisma.business.findMany.mockResolvedValue([voiceBusiness()]);
    mockPrisma.conversationMessage.createMany.mockResolvedValue({ count: 2 });
  });

  const post = (body: Record<string, unknown>) =>
    request(app).post("/api/voice/transcript").set("Authorization", "Bearer test-secret")
      .send({ calledNumber: "972501111111", callerNumber: "+972533391353", ...body });

  it("files spoken turns under the caller's number, marked as spoken", async () => {
    const res = await post({
      turns: [
        { role: "user", content: "אני רוצה צימר לשלושה" },
        { role: "assistant", content: "יש לנו תאנה" },
      ],
    });
    expect(res.status).toBe(200);
    const rows = mockPrisma.conversationMessage.createMany.mock.calls[0][0].data;
    // Same (businessId, phone) key the WhatsApp history uses, so both channels form one thread.
    expect(rows[0]).toMatchObject({ businessId: "biz1", phone: "972533391353", role: "user" });
    // Spoken turns are labelled: a transcription error reads as nonsense without the marker.
    expect(rows[0].content).toMatch(/^📞 /);
    expect(rows[1].content).toBe("יש לנו תאנה");
    // The emoji is for people; this is the part code reads. Turns written as 'whatsapp' would
    // make every call open a WhatsApp window it did not open — see the window checks.
    expect(rows.every((r: { channel: string }) => r.channel === "voice")).toBe(true);
  });

  it("stores nothing for a withheld caller ID", async () => {
    // Filing these under "" would merge every anonymous caller into one unreadable conversation.
    const res = await post({ callerNumber: "unknown", turns: [{ role: "user", content: "שלום" }] });
    expect(res.status).toBe(200);
    expect(res.body.stored).toBe(0);
    expect(mockPrisma.conversationMessage.createMany).not.toHaveBeenCalled();
  });

  it("rejects an empty or oversized batch rather than writing junk", async () => {
    expect((await post({ turns: [] })).status).toBe(400);
    const tooMany = Array.from({ length: 21 }, () => ({ role: "user", content: "x" }));
    expect((await post({ turns: tooMany })).status).toBe(400);
  });
});
