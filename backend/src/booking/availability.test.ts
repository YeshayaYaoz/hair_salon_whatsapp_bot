import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Prisma client before importing the module under test, so no real database
// is needed. Each test configures the mock return values it needs.
const mockPrisma = {
  business: { findUniqueOrThrow: vi.fn() },
  service: { findUniqueOrThrow: vi.fn() },
  businessHours: { findUnique: vi.fn() },
  staffMember: { findMany: vi.fn(), count: vi.fn() },
  appointment: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
  blockedTime: { findMany: vi.fn(), findFirst: vi.fn() },
  customer: { upsert: vi.fn() },
};

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { findAvailableSlots, createAppointment, SlotUnavailableError, OutsideBusinessHoursError } = await import("./availability.js");

const TZ = "Asia/Jerusalem";
const BUSINESS_ID = "biz1";
const SERVICE_ID = "svc1";

// A fixed "now" so slot-filtering (which skips past times) is deterministic.
// Must be BEFORE the dates used in tests below (2026-07-09), or every slot looks "already past".
const FIXED_NOW = new Date("2026-07-01T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  // createAppointment now sizes the slot by staff count (see slotHasRoom); default to an
  // unstaffed business, which is the single-resource behaviour these tests were written against.
  mockPrisma.staffMember.count.mockResolvedValue(0);
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

describe("findAvailableSlots", () => {
  it("returns slots within business hours, correctly converted to UTC in the business timezone", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ timezone: TZ });
    mockPrisma.service.findUniqueOrThrow.mockResolvedValue({ durationMin: 30 });
    // Thursday 2026-07-09, open 09:00-11:00 local (summer, UTC+3)
    mockPrisma.businessHours.findUnique.mockResolvedValue({ openMin: 9 * 60, closeMin: 11 * 60 });
    mockPrisma.staffMember.findMany.mockResolvedValue([]);
    mockPrisma.appointment.findMany.mockResolvedValue([]);
    mockPrisma.blockedTime.findMany.mockResolvedValue([]);

    const slots = await findAvailableSlots(BUSINESS_ID, SERVICE_ID, "2026-07-09");

    // 09:00, 09:30, 10:00, 10:30 local — the last 30-min slot that still fits before 11:00 close.
    expect(slots.map((s) => s.startTime)).toEqual([
      "2026-07-09T06:00:00.000Z",
      "2026-07-09T06:30:00.000Z",
      "2026-07-09T07:00:00.000Z",
      "2026-07-09T07:30:00.000Z",
    ]);
  });

  it("returns nothing when the business has no hours configured for that day", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ timezone: TZ });
    mockPrisma.service.findUniqueOrThrow.mockResolvedValue({ durationMin: 30 });
    mockPrisma.businessHours.findUnique.mockResolvedValue(null); // closed that day
    mockPrisma.staffMember.findMany.mockResolvedValue([]);
    mockPrisma.appointment.findMany.mockResolvedValue([]);
    mockPrisma.blockedTime.findMany.mockResolvedValue([]);

    const slots = await findAvailableSlots(BUSINESS_ID, SERVICE_ID, "2026-07-09");
    expect(slots).toEqual([]);
  });

  it("excludes a slot that overlaps an existing confirmed appointment", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ timezone: TZ });
    mockPrisma.service.findUniqueOrThrow.mockResolvedValue({ durationMin: 30 });
    mockPrisma.businessHours.findUnique.mockResolvedValue({ openMin: 9 * 60, closeMin: 10 * 60 });
    mockPrisma.staffMember.findMany.mockResolvedValue([]);
    // 09:00-09:30 local is already booked (06:00-06:30 UTC).
    mockPrisma.appointment.findMany.mockResolvedValue([
      { staffId: null, startTime: new Date("2026-07-09T06:00:00.000Z"), endTime: new Date("2026-07-09T06:30:00.000Z") },
    ]);
    mockPrisma.blockedTime.findMany.mockResolvedValue([]);

    const slots = await findAvailableSlots(BUSINESS_ID, SERVICE_ID, "2026-07-09");
    expect(slots.map((s) => s.startTime)).toEqual(["2026-07-09T06:30:00.000Z"]);
  });

  it("excludes a slot that overlaps an owner-defined blocked time (vacation/break)", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ timezone: TZ });
    mockPrisma.service.findUniqueOrThrow.mockResolvedValue({ durationMin: 30 });
    mockPrisma.businessHours.findUnique.mockResolvedValue({ openMin: 9 * 60, closeMin: 10 * 60 });
    mockPrisma.staffMember.findMany.mockResolvedValue([]);
    mockPrisma.appointment.findMany.mockResolvedValue([]);
    // Whole morning blocked off.
    mockPrisma.blockedTime.findMany.mockResolvedValue([
      { startTime: new Date("2026-07-09T00:00:00.000Z"), endTime: new Date("2026-07-09T06:30:00.000Z") },
    ]);

    const slots = await findAvailableSlots(BUSINESS_ID, SERVICE_ID, "2026-07-09");
    expect(slots.map((s) => s.startTime)).toEqual(["2026-07-09T06:30:00.000Z"]);
  });

  it("respects a durationMin override when computing the last bookable slot", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ timezone: TZ });
    mockPrisma.service.findUniqueOrThrow.mockResolvedValue({ durationMin: 30 });
    mockPrisma.businessHours.findUnique.mockResolvedValue({ openMin: 9 * 60, closeMin: 10 * 60 });
    mockPrisma.staffMember.findMany.mockResolvedValue([]);
    mockPrisma.appointment.findMany.mockResolvedValue([]);
    mockPrisma.blockedTime.findMany.mockResolvedValue([]);

    // With a 60-min override in a 09:00-10:00 window, only the 09:00 start fits.
    const slots = await findAvailableSlots(BUSINESS_ID, SERVICE_ID, "2026-07-09", 60);
    expect(slots.map((s) => s.startTime)).toEqual(["2026-07-09T06:00:00.000Z"]);
  });

  it("only offers times the preferred staff member is free at, when a preference is given", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ timezone: TZ });
    mockPrisma.service.findUniqueOrThrow.mockResolvedValue({ durationMin: 30 });
    mockPrisma.businessHours.findUnique.mockResolvedValue({ openMin: 9 * 60, closeMin: 10 * 60 });
    mockPrisma.staffMember.findMany.mockResolvedValue([{ id: "staff-a" }, { id: "staff-b" }]);
    // staff-a is booked 09:00-09:30; staff-b is free the whole window.
    mockPrisma.appointment.findMany.mockResolvedValue([
      { staffId: "staff-a", startTime: new Date("2026-07-09T06:00:00.000Z"), endTime: new Date("2026-07-09T06:30:00.000Z") },
    ]);
    mockPrisma.blockedTime.findMany.mockResolvedValue([]);

    const slots = await findAvailableSlots(BUSINESS_ID, SERVICE_ID, "2026-07-09", undefined, "staff-a");

    // Even though staff-b is free at 09:00, the customer asked for staff-a specifically —
    // that slot must not be silently offered with a different staff member substituted in.
    expect(slots.every((s) => s.staffId === "staff-a")).toBe(true);
    expect(slots.map((s) => s.startTime)).toEqual(["2026-07-09T06:30:00.000Z"]);
  });
});

describe("createAppointment", () => {
  const baseParams = {
    businessId: BUSINESS_ID,
    serviceId: SERVICE_ID,
    customerPhone: "972500000000",
    customerName: "Test Customer",
  };

  function mockHappyPath(overrides: Partial<{ hours: { openMin: number; closeMin: number } | null }> = {}) {
    mockPrisma.service.findUniqueOrThrow.mockResolvedValue({ durationMin: 30 });
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ timezone: TZ });
    mockPrisma.businessHours.findUnique.mockResolvedValue(
      overrides.hours !== undefined ? overrides.hours : { openMin: 9 * 60, closeMin: 17 * 60 }
    );
    mockPrisma.blockedTime.findFirst.mockResolvedValue(null);
    mockPrisma.customer.upsert.mockResolvedValue({ id: "cust1" });
    // Overlap is now a findMany + slotHasRoom check, so the two rules can't diverge — see
    // slotHasRoom's comment for the bug that came from them diverging.
    mockPrisma.appointment.findMany.mockResolvedValue([]); // no overlap
    mockPrisma.appointment.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "appt1", ...data }));
  }

  it("books successfully when the time is within business hours and the slot is free", async () => {
    mockHappyPath();
    const appt = await createAppointment({ ...baseParams, startTime: new Date("2026-07-09T07:00:00.000Z") }); // 10:00 local
    expect(appt.id).toBe("appt1");
    expect(mockPrisma.appointment.create).toHaveBeenCalledOnce();
  });

  it("rejects a booking that starts before opening time", async () => {
    mockHappyPath({ hours: { openMin: 9 * 60, closeMin: 17 * 60 } });
    // 08:00 local, 1 hour before the 09:00 open.
    await expect(
      createAppointment({ ...baseParams, startTime: new Date("2026-07-09T05:00:00.000Z") })
    ).rejects.toThrow(OutsideBusinessHoursError);
  });

  it("rejects a booking that would run past closing time — the real bug from this session (14:00 close, 40-min service booked at 14:00 would run to 14:40)", async () => {
    mockHappyPath({ hours: { openMin: 8 * 60, closeMin: 14 * 60 } }); // closes 14:00 local
    mockPrisma.service.findUniqueOrThrow.mockResolvedValue({ durationMin: 40 });
    // 14:00 local start with a 40-min service ends at 14:40, past the 14:00 close.
    await expect(
      createAppointment({ ...baseParams, startTime: new Date("2026-07-09T11:00:00.000Z") }) // 14:00 local (summer, UTC+3)
    ).rejects.toThrow(OutsideBusinessHoursError);
  });

  it("rejects a booking on a day with no configured hours (closed day)", async () => {
    mockHappyPath({ hours: null });
    await expect(
      createAppointment({ ...baseParams, startTime: new Date("2026-07-09T07:00:00.000Z") })
    ).rejects.toThrow(OutsideBusinessHoursError);
  });

  it("rejects a booking that falls inside an owner-defined blocked period", async () => {
    mockHappyPath();
    mockPrisma.blockedTime.findFirst.mockResolvedValue({ id: "block1" });
    await expect(
      createAppointment({ ...baseParams, startTime: new Date("2026-07-09T07:00:00.000Z") })
    ).rejects.toThrow(OutsideBusinessHoursError);
  });

  it("rejects a double-booking when the slot was taken between offer and confirm", async () => {
    mockHappyPath();
    mockPrisma.appointment.findMany.mockResolvedValue([{ staffId: null }]); // overlap found
    await expect(
      createAppointment({ ...baseParams, startTime: new Date("2026-07-09T07:00:00.000Z") })
    ).rejects.toThrow(SlotUnavailableError);
  });

  it("does not overwrite the customer's saved name when customerName is omitted on a repeat booking", async () => {
    mockHappyPath();
    await createAppointment({
      businessId: BUSINESS_ID,
      serviceId: SERVICE_ID,
      customerPhone: "972500000000",
      startTime: new Date("2026-07-09T07:00:00.000Z"),
      // customerName omitted
    });
    expect(mockPrisma.customer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} })
    );
  });
});

describe("capacity (group classes)", () => {
  it("keeps offering a class slot until it reaches capacity, then hides it", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ timezone: TZ });
    mockPrisma.service.findUniqueOrThrow.mockResolvedValue({ durationMin: 60, capacity: 3 });
    // Thursday 2026-07-09, open 09:00-10:00 local → exactly one 60-min class slot at 09:00 (06:00Z).
    mockPrisma.businessHours.findUnique.mockResolvedValue({ openMin: 9 * 60, closeMin: 10 * 60 });
    mockPrisma.staffMember.findMany.mockResolvedValue([]);
    mockPrisma.blockedTime.findMany.mockResolvedValue([]);

    // 2 of 3 spots taken → still offered.
    mockPrisma.appointment.findMany.mockResolvedValue([
      { serviceId: SERVICE_ID, startTime: new Date("2026-07-09T06:00:00.000Z"), endTime: new Date("2026-07-09T07:00:00.000Z"), staffId: null },
      { serviceId: SERVICE_ID, startTime: new Date("2026-07-09T06:00:00.000Z"), endTime: new Date("2026-07-09T07:00:00.000Z"), staffId: null },
    ]);
    let slots = await findAvailableSlots(BUSINESS_ID, SERVICE_ID, "2026-07-09");
    expect(slots.map((s) => s.startTime)).toEqual(["2026-07-09T06:00:00.000Z"]);

    // 3 of 3 taken → full, no longer offered.
    mockPrisma.appointment.findMany.mockResolvedValue([
      { serviceId: SERVICE_ID, startTime: new Date("2026-07-09T06:00:00.000Z"), endTime: new Date("2026-07-09T07:00:00.000Z"), staffId: null },
      { serviceId: SERVICE_ID, startTime: new Date("2026-07-09T06:00:00.000Z"), endTime: new Date("2026-07-09T07:00:00.000Z"), staffId: null },
      { serviceId: SERVICE_ID, startTime: new Date("2026-07-09T06:00:00.000Z"), endTime: new Date("2026-07-09T07:00:00.000Z"), staffId: null },
    ]);
    slots = await findAvailableSlots(BUSINESS_ID, SERVICE_ID, "2026-07-09");
    expect(slots).toEqual([]);
  });

  it("does not count a DIFFERENT service's bookings against a class's capacity", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ timezone: TZ });
    mockPrisma.service.findUniqueOrThrow.mockResolvedValue({ durationMin: 60, capacity: 2 });
    mockPrisma.businessHours.findUnique.mockResolvedValue({ openMin: 9 * 60, closeMin: 10 * 60 });
    mockPrisma.staffMember.findMany.mockResolvedValue([]);
    mockPrisma.blockedTime.findMany.mockResolvedValue([]);
    // An overlapping booking for ANOTHER service should not consume this class's spots.
    mockPrisma.appointment.findMany.mockResolvedValue([
      { serviceId: "other-svc", startTime: new Date("2026-07-09T06:00:00.000Z"), endTime: new Date("2026-07-09T07:00:00.000Z"), staffId: null },
    ]);
    const slots = await findAvailableSlots(BUSINESS_ID, SERVICE_ID, "2026-07-09");
    expect(slots.map((s) => s.startTime)).toEqual(["2026-07-09T06:00:00.000Z"]);
  });

  it("rejects a class booking once the slot is full (createAppointment)", async () => {
    mockPrisma.service.findUniqueOrThrow.mockResolvedValue({ durationMin: 60, capacity: 2 });
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ timezone: TZ });
    mockPrisma.businessHours.findUnique.mockResolvedValue({ openMin: 9 * 60, closeMin: 17 * 60 });
    mockPrisma.blockedTime.findFirst.mockResolvedValue(null);
    mockPrisma.customer.upsert.mockResolvedValue({ id: "cust1" });
    mockPrisma.appointment.count.mockResolvedValue(2); // already full
    await expect(
      createAppointment({ businessId: BUSINESS_ID, serviceId: SERVICE_ID, customerPhone: "972500000000", startTime: new Date("2026-07-09T07:00:00.000Z") })
    ).rejects.toThrow(SlotUnavailableError);
  });

  it("allows a class booking when the slot still has room (createAppointment)", async () => {
    mockPrisma.service.findUniqueOrThrow.mockResolvedValue({ durationMin: 60, capacity: 5 });
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ timezone: TZ });
    mockPrisma.businessHours.findUnique.mockResolvedValue({ openMin: 9 * 60, closeMin: 17 * 60 });
    mockPrisma.blockedTime.findFirst.mockResolvedValue(null);
    mockPrisma.customer.upsert.mockResolvedValue({ id: "cust1" });
    mockPrisma.appointment.count.mockResolvedValue(1); // room for more
    mockPrisma.appointment.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "appt1", ...data }));
    const appt = await createAppointment({ businessId: BUSINESS_ID, serviceId: SERVICE_ID, customerPhone: "972500000000", startTime: new Date("2026-07-09T07:00:00.000Z") });
    expect(appt.id).toBe("appt1");
    expect(mockPrisma.appointment.findFirst).not.toHaveBeenCalled(); // used capacity count, not 1:1 overlap
  });
});
