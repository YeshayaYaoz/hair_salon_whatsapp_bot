import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * End-to-end through the real chain: runTool → the real checkManager → the real managerActions,
 * against a stateful in-memory store standing in for the database.
 *
 * The other manager tests each hold one link still: managerAuth tests the check alone, managerTools
 * mocks managerActions away to prove the guard. Neither would notice if the guard passed and the
 * write then went to the wrong row, or if a preview quietly wrote. This drives the whole sequence
 * an owner actually performs — ask, propose, confirm, ask again — and asserts on the store.
 */

interface HoursRow { businessId: string; dayOfWeek: number; openMin: number; closeMin: number }
interface ServiceRow { id: string; businessId: string; name: string; priceCents: number; durationMin: number }

const db = {
  businesses: [] as { id: string; name: string; notificationPhone: string | null; timezone: string; botEnabled: boolean }[],
  hours: [] as HoursRow[],
  services: [] as ServiceRow[],
};

const byBusiness = <T extends { businessId: string }>(rows: T[], where: { businessId?: string }) =>
  rows.filter((r) => !where?.businessId || r.businessId === where.businessId);

const mockPrisma = {
  business: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.businesses.find((b) => b.id === where.id) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const b = db.businesses.find((x) => x.id === where.id);
      if (!b) throw new Error("no business");
      return b;
    }),
    update: vi.fn(),
  },
  businessHours: {
    findMany: vi.fn(async ({ where }: { where: { businessId?: string } }) =>
      byBusiness(db.hours, where).sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    ),
    deleteMany: vi.fn(async ({ where }: { where: { businessId: string; dayOfWeek: number } }) => {
      db.hours = db.hours.filter((h) => !(h.businessId === where.businessId && h.dayOfWeek === where.dayOfWeek));
      return { count: 1 };
    }),
    upsert: vi.fn(async ({ where, create, update }: {
      where: { businessId_dayOfWeek: { businessId: string; dayOfWeek: number } };
      create: HoursRow;
      update: Partial<HoursRow>;
    }) => {
      const key = where.businessId_dayOfWeek;
      const existing = db.hours.find((h) => h.businessId === key.businessId && h.dayOfWeek === key.dayOfWeek);
      if (existing) Object.assign(existing, update);
      else db.hours.push({ ...create });
      return existing ?? create;
    }),
  },
  service: {
    findMany: vi.fn(async ({ where }: { where: { businessId?: string } }) =>
      byBusiness(db.services, where).sort((a, b) => a.name.localeCompare(b.name))
    ),
    create: vi.fn(async ({ data }: { data: Omit<ServiceRow, "id"> }) => {
      const row = { id: `s${db.services.length + 1}`, ...data };
      db.services.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ServiceRow> }) => {
      const row = db.services.find((s) => s.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
  },
  staffMember: { findMany: vi.fn(async () => []), create: vi.fn(), deleteMany: vi.fn() },
  faqEntry: { findMany: vi.fn(async () => []), create: vi.fn() },
  waitlistEntry: { findMany: vi.fn(async () => []) },
  blockedTime: { findMany: vi.fn(async () => []), deleteMany: vi.fn(), create: vi.fn() },
  customer: { findMany: vi.fn(async () => []), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  customerCoupon: { findUnique: vi.fn(), create: vi.fn() },
  appointment: { findFirst: vi.fn(), findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
};
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/crypto.js", () => ({ decryptSecret: (s: string) => s }));
vi.mock("../lib/errorMonitoring.js", () => ({ captureError: vi.fn() }));
vi.mock("../webhook/whatsappClient.js", () => ({ sendWhatsAppMessage: vi.fn() }));
vi.mock("../lib/receipts.js", () => ({
  issueAndSendReceipt: vi.fn(),
  NoInvoiceProviderError: class extends Error {},
  DELIVERY_MESSAGE_HE: { sent: "", window_closed: "", no_whatsapp: "", failed: "" },
}));
vi.mock("../booking/actions.js", () => ({ cancelAppointmentById: vi.fn() }));
vi.mock("../booking/customerCoupons.js", () => ({
  quoteCustomerCoupon: vi.fn(),
  redeemCustomerCoupon: vi.fn(),
  releaseCustomerCoupon: vi.fn(),
  CustomerCouponError: class extends Error {},
  CUSTOMER_COUPON_FAILURE_HE: {},
}));

const { runTool } = await import("./claudeBot.js");

const OWNER = "972501234567";
const CUSTOMER = "972508888888";
const noSlots = { value: undefined };
const noPhotos = { value: undefined };

const call = async (from: string, tool: string, input: Record<string, unknown>) =>
  JSON.parse(await runTool("b1", from, tool, input, noSlots, noPhotos));

beforeEach(() => {
  db.businesses = [{ id: "b1", name: "מספרת רונית", notificationPhone: OWNER, timezone: "Asia/Jerusalem", botEnabled: true }];
  db.hours = [{ businessId: "b1", dayOfWeek: 2, openMin: 540, closeMin: 1020 }]; // Tuesday 09:00–17:00
  db.services = [{ id: "s1", businessId: "b1", name: "תספורת", priceCents: 10000, durationMin: 30 }];
});

describe("changing opening hours from WhatsApp, end to end", () => {
  it("reads back the current hours the owner actually has", async () => {
    const out = await call(OWNER, "show_settings", { what: "hours" });

    expect(out.hours).toEqual([{ day: "שלישי", dayOfWeek: 2, open: "09:00", close: "17:00" }]);
    // Every other day has no row, and the owner needs to hear that as "closed" rather than silence.
    expect(out.closedDays).toContain("ראשון");
  });

  it("proposes the change without touching the database", async () => {
    const out = await call(OWNER, "set_hours", { day: "שלישי", open: "10:00", close: "18:00" });

    expect(out.needsConfirmation).toBe(true);
    expect(out.willSet).toMatchObject({ day: "שלישי", open: "10:00", close: "18:00" });
    expect(db.hours[0]).toMatchObject({ openMin: 540, closeMin: 1020 }); // untouched
  });

  it("writes the row once confirmed, and the next read shows it", async () => {
    await call(OWNER, "set_hours", { day: "שלישי", open: "10:00", close: "18:00" });
    const done = await call(OWNER, "set_hours", { day: "שלישי", open: "10:00", close: "18:00", confirmed: true });

    expect(done.updated).toBe(true);
    expect(db.hours).toEqual([{ businessId: "b1", dayOfWeek: 2, openMin: 600, closeMin: 1080 }]);

    const after = await call(OWNER, "show_settings", { what: "hours" });
    expect(after.hours[0]).toMatchObject({ open: "10:00", close: "18:00" });
  });

  it("closes a day by removing the row, not by storing an empty window", async () => {
    await call(OWNER, "set_hours", { day: "שלישי", closed: true, confirmed: true });

    expect(db.hours).toEqual([]);
    expect((await call(OWNER, "show_settings", { what: "hours" })).closedDays).toContain("שלישי");
  });

  it("refuses hours that end before they start, before any confirmation", async () => {
    const out = await call(OWNER, "set_hours", { day: "שלישי", open: "17:00", close: "09:00", confirmed: true });

    expect(out.error).toBeTruthy();
    expect(db.hours[0]).toMatchObject({ openMin: 540 });
  });
});

describe("changing prices from WhatsApp, end to end", () => {
  it("updates the existing service rather than creating a second one with the same name", async () => {
    await call(OWNER, "upsert_service", { name: "תספורת", priceIls: 120, durationMin: 45, confirmed: true });

    expect(db.services).toHaveLength(1);
    expect(db.services[0]).toMatchObject({ id: "s1", priceCents: 12000, durationMin: 45 });
  });

  it("creates a new service when the name is new", async () => {
    await call(OWNER, "upsert_service", { name: "צבע", priceIls: 250, durationMin: 90, confirmed: true });

    expect(db.services).toHaveLength(2);
    expect(db.services.find((s) => s.name === "צבע")).toMatchObject({ priceCents: 25000, durationMin: 90 });
  });

  it("keeps the unspecified field when the owner changes only the price", async () => {
    // "תספורת עכשיו 120" must not silently reset the duration to a default.
    await call(OWNER, "upsert_service", { name: "תספורת", priceIls: 120, confirmed: true });

    expect(db.services[0]).toMatchObject({ priceCents: 12000, durationMin: 30 });
  });

  it("asks rather than inventing a price for a service that does not exist", async () => {
    const out = await call(OWNER, "upsert_service", { name: "פן", confirmed: true });

    expect(out.error).toBeTruthy();
    expect(db.services).toHaveLength(1);
  });
});

describe("the same sequence from a customer's handset", () => {
  it("changes nothing at any step", async () => {
    for (const [tool, input] of [
      ["show_settings", { what: "hours" }],
      ["set_hours", { day: "שלישי", open: "10:00", close: "18:00" }],
      ["set_hours", { day: "שלישי", open: "10:00", close: "18:00", confirmed: true }],
      ["upsert_service", { name: "תספורת", priceIls: 1, durationMin: 5, confirmed: true }],
    ] as [string, Record<string, unknown>][]) {
      const out = await call(CUSTOMER, tool, input);
      expect(out.error).toBeTruthy();
      expect(out.needsConfirmation).toBeUndefined();
    }

    expect(db.hours).toEqual([{ businessId: "b1", dayOfWeek: 2, openMin: 540, closeMin: 1020 }]);
    expect(db.services[0]).toMatchObject({ priceCents: 10000, durationMin: 30 });
  });

  it("is refused even after the owner used the same tool in the same business", async () => {
    // Nothing about the guard is per-conversation state that a prior success could warm up.
    await call(OWNER, "set_hours", { day: "שלישי", open: "10:00", close: "18:00", confirmed: true });

    expect((await call(CUSTOMER, "set_hours", { day: "שלישי", closed: true, confirmed: true })).error).toBeTruthy();
    expect(db.hours).toHaveLength(1);
  });

  it("is refused when the owner's number is removed mid-session", async () => {
    db.businesses[0].notificationPhone = null;

    expect((await call(OWNER, "show_settings", { what: "hours" })).error).toBeTruthy();
  });
});
