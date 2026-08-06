import { describe, it, expect, vi, beforeEach } from "vitest";
import { TEMPLATES, BUSINESS_TYPES } from "./businessTemplates.js";

const mockPrisma = {
  business: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  service: { createMany: vi.fn() },
  businessHours: { count: vi.fn(), createMany: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));

const { applyTemplate } = await import("./applyTemplate.js");

function existingBusiness(overrides: Record<string, unknown> = {}) {
  return {
    businessTypeChosenAt: null,
    botPersonality: null,
    cancellationPolicy: null,
    referralText: null,
    availabilityInfo: null,
    _count: { services: 0 },
    ...overrides,
  };
}

describe("applyTemplate — seeded opening hours", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.business.update.mockResolvedValue({});
    mockPrisma.service.createMany.mockResolvedValue({ count: 3 });
    mockPrisma.businessHours.count.mockResolvedValue(0);
    mockPrisma.businessHours.createMany.mockImplementation(({ data }: { data: unknown[] }) =>
      Promise.resolve({ count: data.length })
    );
  });

  it("seeds a starting week on first selection", async () => {
    // Hours were the only critical setup step that began completely empty — seven days entered by
    // hand before the bot could book anything, while services arrived pre-filled.
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(existingBusiness());

    const result = await applyTemplate("biz1", "salon");

    expect(result.seededHours).toBe(TEMPLATES.salon.seedHours.length);
    expect(result.seededHours).toBeGreaterThan(0);
    const seeded = mockPrisma.businessHours.createMany.mock.calls[0][0].data;
    expect(seeded.every((h: { businessId: string }) => h.businessId === "biz1")).toBe(true);
  });

  it("leaves an owner's existing hours alone", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(existingBusiness());
    mockPrisma.businessHours.count.mockResolvedValue(5);

    const result = await applyTemplate("biz1", "salon");

    expect(mockPrisma.businessHours.createMany).not.toHaveBeenCalled();
    expect(result.seededHours).toBe(0);
  });

  it("does not re-seed when the owner switches category later", async () => {
    // Same rule as services: re-picking must not resurrect rows the owner deliberately deleted.
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      existingBusiness({ businessTypeChosenAt: new Date("2026-01-01") })
    );

    const result = await applyTemplate("biz1", "clinic");

    expect(mockPrisma.businessHours.createMany).not.toHaveBeenCalled();
    expect(result.seededHours).toBe(0);
  });

  it("seeds nothing for inquiry-mode verticals, which have no slot engine", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(existingBusiness());

    const result = await applyTemplate("biz1", "bnb");

    expect(TEMPLATES.bnb.presets.bookingModel).toBe("inquiry");
    expect(mockPrisma.businessHours.createMany).not.toHaveBeenCalled();
    expect(result.seededHours).toBe(0);
  });

  it("every slot-based vertical seeds a usable week", () => {
    for (const type of BUSINESS_TYPES) {
      const t = TEMPLATES[type];
      if (t.presets.bookingModel === "inquiry") continue;

      expect(t.seedHours.length, `${type} seeds no hours`).toBeGreaterThan(0);
      for (const h of t.seedHours) {
        expect(h.dayOfWeek, `${type} day out of range`).toBeGreaterThanOrEqual(0);
        expect(h.dayOfWeek, `${type} day out of range`).toBeLessThanOrEqual(6);
        // A day that closes before it opens would silently produce zero bookable slots.
        expect(h.closeMin, `${type} day ${h.dayOfWeek} closes before it opens`).toBeGreaterThan(h.openMin);
        expect(h.closeMin, `${type} day ${h.dayOfWeek} runs past midnight`).toBeLessThanOrEqual(24 * 60);
      }
      // The unique index is on (businessId, dayOfWeek) — a duplicate day would be dropped silently.
      const days = t.seedHours.map((h) => h.dayOfWeek);
      expect(new Set(days).size, `${type} repeats a day`).toBe(days.length);
      // Saturday is closed for every vertical here; seeding it would be a claim, not a default.
      expect(days, `${type} seeds Saturday`).not.toContain(6);
    }
  });
});
