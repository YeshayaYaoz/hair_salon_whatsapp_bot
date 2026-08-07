import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  business: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn() },
  customer: { findUnique: vi.fn() },
};
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { buildSystemPrompt } = await import("./prompt.js");

function business(overrides: Record<string, unknown> = {}) {
  return {
    id: "biz1", name: "צימר בדיקה", businessType: "bnb", bookingModel: "inquiry",
    timezone: "Asia/Jerusalem", address: null, googleMapsUrl: null,
    botGreeting: "שלום וברוכים הבאים לצימר מירון! 🌿", botPersonality: null,
    cancellationPolicy: null, pricingNotes: null, availabilityInfo: null,
    availabilitySuggestionsEnabled: true,
    services: [], hours: [], staff: [], faqEntries: [], specialPeriods: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.customer.findUnique.mockResolvedValue(null);
});

/**
 * The owner's welcome now goes out as its own message ahead of the reply, because folded into it
 * the model paraphrased, trimmed or dropped it once there was a real question to answer — someone
 * opening with "how much for the weekend?" got straight pricing and never saw it.
 */
describe("greeting sent as its own message", () => {
  it("takes the greeting text out of the prompt and forbids opening with one", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business());
    const { stable } = await buildSystemPrompt("biz1", undefined, true);

    // Leaving it in would get it half-repeated at the top of the reply the customer reads next.
    expect(stable).not.toContain("שלום וברוכים הבאים לצימר מירון");
    expect(stable).toContain("הודעת פתיחה כבר נשלחה");
  });

  it("keeps the old behaviour when the greeting is not being sent separately", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business());
    const { stable } = await buildSystemPrompt("biz1", undefined, false);

    expect(stable).toContain("שלום וברוכים הבאים לצימר מירון");
    expect(stable).not.toContain("הודעת פתיחה כבר נשלחה");
  });
});
