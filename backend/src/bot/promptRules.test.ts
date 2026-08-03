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
