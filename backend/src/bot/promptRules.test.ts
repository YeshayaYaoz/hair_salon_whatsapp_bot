import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  business: { findUniqueOrThrow: vi.fn() },
  customer: { findUnique: vi.fn() },
};

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { buildSystemPrompt } = await import("./prompt.js");
const RULES = await import("./rules.js");

/** A business with nothing optional configured — the minimum that still builds a prompt. */
function business(overrides: Record<string, unknown> = {}) {
  return {
    id: "biz1",
    name: "צימר בדיקה",
    businessType: "bnb",
    bookingModel: "slot",
    timezone: "Asia/Jerusalem",
    address: null,
    googleMapsUrl: null,
    botGreeting: null,
    botPersonality: null,
    cancellationPolicy: null,
    pricingNotes: null,
    availabilityInfo: null,
    availabilitySuggestionsEnabled: true,
    services: [],
    hours: [],
    staff: [],
    faqEntries: [],
    specialPeriods: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.customer.findUnique.mockResolvedValue(null);
});

/**
 * These rules exist because each one was written after a specific customer-visible bug. Extracting
 * them into rules.ts made them easy to edit — and equally easy to drop from the template by
 * accident, with no compile error and no failing test to notice. This suite is the guard: every
 * exported rule has to actually reach the prompt the model receives.
 */
describe("every rule reaches the prompt", () => {
  const ALWAYS_PRESENT = [
    ["HONESTY_RULES", RULES.HONESTY_RULES],
    ["LANGUAGE_RULES", RULES.LANGUAGE_RULES],
    ["BREVITY_RULE", RULES.BREVITY_RULE],
    ["FORMATTING_RULES", RULES.FORMATTING_RULES],
    ["CALENDAR_RULES", RULES.CALENDAR_RULES],
    ["CONVERSATION_AGE_RULE", RULES.CONVERSATION_AGE_RULE],
    ["PHOTOS_RULE", RULES.PHOTOS_RULE],
    ["PRICING_RULE", RULES.PRICING_RULE],
  ] as const;

  it.each(ALWAYS_PRESENT)("includes %s", async (_name, rule) => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business());
    const { stable } = await buildSystemPrompt("biz1");
    expect(stable).toContain(rule);
  });

  /**
   * Guards a real conversation: a family of five was offered the 10-guest unit at ₪3,000 and never
   * shown the 7-guest one at ₪2,100 until they named it themselves. Only overnight businesses rent
   * units with guest limits, so a salon must not carry this rule as noise.
   */
  it("includes the unit-fit rule for overnight businesses only", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business());
    expect((await buildSystemPrompt("biz1")).stable).toContain(RULES.UNIT_FIT_RULE);

    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business({ businessType: "hair_salon" }));
    expect((await buildSystemPrompt("biz1")).stable).not.toContain(RULES.UNIT_FIT_RULE);
  });

  /**
   * Occupancy used to be one clause inside a description and got read past. Printed as its own
   * labelled field it is the thing the model reports to find_units_for_guests, which then does the
   * comparison — so if this stops rendering, the tool is being called with nothing behind it.
   */
  it("prints each unit's occupancy as a field of its own, for overnight businesses only", async () => {
    const unit = {
      name: "גפן", description: "יחידה משפחתית", priceCents: 210000, durationMin: 1440,
      maxGuests: 7, imageUrls: [], linkUrl: null,
    };
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business({ services: [unit] }));
    expect((await buildSystemPrompt("biz1")).stable).toContain("[עד 7 אורחים]");

    // A salon has no party size to fit, so the label would be noise there.
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      business({ businessType: "hair_salon", services: [unit] })
    );
    expect((await buildSystemPrompt("biz1")).stable).not.toContain("אורחים]");
  });

  it("says nothing about occupancy for a unit the owner left blank", async () => {
    // Silence here is what makes the unit come back as capacityUnknown rather than being ruled out.
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      business({ services: [{ name: "אלון", description: null, priceCents: 250000, durationMin: 1440, maxGuests: null, imageUrls: [], linkUrl: null }] })
    );
    const { stable } = await buildSystemPrompt("biz1");
    expect(stable).toContain("אלון");
    expect(stable).not.toContain("אורחים]");
  });

  it("includes the placeholder rule only when the owner wrote a greeting", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business());
    expect((await buildSystemPrompt("biz1")).stable).not.toContain(RULES.PLACEHOLDER_RULE);

    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      business({ botGreeting: "שלום! [פירוט של כל הצימרים]" })
    );
    const { stable } = await buildSystemPrompt("biz1");
    expect(stable).toContain(RULES.PLACEHOLDER_RULE);
    expect(stable).toContain("[פירוט של כל הצימרים]");
  });
});

describe("booking section is chosen by booking model", () => {
  it("gives slot businesses the booking rulebook and not the inquiry one", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business({ bookingModel: "slot" }));
    const { stable } = await buildSystemPrompt("biz1");
    expect(stable).toContain("book_appointment");
    expect(stable).not.toContain("request_booking_callback");
  });

  it("gives inquiry businesses the handoff rulebook and no booking tools", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business({ bookingModel: "inquiry" }));
    const { stable } = await buildSystemPrompt("biz1");
    expect(stable).toContain("request_booking_callback");
    expect(stable).not.toContain("book_appointment");
    // Opening hours are meaningless for an overnight rental and would otherwise render empty.
    expect(stable).not.toContain("שעות פעילות:");
  });

  /**
   * Inquiry businesses have no booking call to hang name collection off, so without an explicit
   * instruction the bot would chat with a guest by name and still leave the row nameless — which
   * is what a real B&B's customers list looked like.
   */
  it("tells inquiry businesses to ask for a name and to record it outside of booking", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business({ bookingModel: "inquiry" }));
    const { stable } = await buildSystemPrompt("biz1");
    expect(stable).toContain("save_customer_name");
    expect(stable).toContain("גם אם אינו מזמין");
  });
});

describe("availability stance for inquiry businesses", () => {
  it("forbids any availability answer when the owner switched suggestions off", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      business({ bookingModel: "inquiry", availabilitySuggestionsEnabled: false, availabilityInfo: "בדרך כלל פנוי" })
    );
    const { stable } = await buildSystemPrompt("biz1");
    expect(stable).toContain(RULES.AVAILABILITY_LINES.disabled);
    // The owner's own text must not leak out when they turned this off.
    expect(stable).not.toContain("בדרך כלל פנוי");
  });

  it("relays the owner's policy when one is written", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      business({ bookingModel: "inquiry", availabilityInfo: "סופי שבוע נסגרים מראש" })
    );
    expect((await buildSystemPrompt("biz1")).stable).toContain("סופי שבוע נסגרים מראש");
  });

  it("falls back to deferring to the owner when nothing is written", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business({ bookingModel: "inquiry" }));
    expect((await buildSystemPrompt("biz1")).stable).toContain(RULES.AVAILABILITY_LINES.unknown);
  });
});

describe("the night-counting rule", () => {
  // The regression this guards: מוצ״ש rules added to make counting more precise instead made the
  // bot quote a Thursday→motzash stay as 4 nights. The worked example is the fix.
  it("states the Thursday-to-motzash case explicitly", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business());
    const { stable } = await buildSystemPrompt("biz1");
    expect(stable).toContain("כניסה בחמישי ויציאה במוצ״ש = 2 לילות");
  });

  it("no longer tells the bot motzash is a separate bookable night", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business());
    const { stable } = await buildSystemPrompt("biz1");
    expect(stable).not.toContain("לילה נוסף");
  });
});

describe("prompt caching split", () => {
  // Anything that changes per-minute must stay out of `stable`, or the cached prefix is busted on
  // every single call and the whole prompt is re-billed at full input rate.
  it("keeps the clock out of the cacheable block", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business());
    const { stable, volatile } = await buildSystemPrompt("biz1");
    expect(volatile).toMatch(/\d{2}:\d{2}/);
    expect(stable).not.toContain("השעה כעת");
  });

  it("keeps stable identical across calls a minute apart", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business());
    const first = (await buildSystemPrompt("biz1")).stable;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 90_000));
    const second = (await buildSystemPrompt("biz1")).stable;
    vi.useRealTimers();
    expect(second).toBe(first);
  });
});
