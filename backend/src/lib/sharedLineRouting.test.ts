import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Which business a stranger on Tori's line is a customer of. Each rule guards a real failure: a
 * code that resolves to a business with its own number would answer from the wrong line, a
 * Receipts-plan business has no bot to answer with, a returning customer who has to find the link
 * again is a lost booking, and a prospect answering cold outreach days after trying the demo
 * must reach a person and not the demo salon.
 */
const getHistory = vi.fn(async (): Promise<unknown[]> => []);
vi.mock("../bot/conversationStore.js", () => ({ getHistory: (...a: unknown[]) => getHistory(...a) }));
const mockPrisma = {
  business: { findUnique: vi.fn(), update: vi.fn() },
  conversationMessage: { findMany: vi.fn(async () => [] as { businessId: string }[]) },
};
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));

const { resolveSharedStranger, parseSharedCode, generateSharedCode, ensureSharedLineCode, sharedLineLink } =
  await import("./sharedLineRouting.js");

const salon = { id: "salon", name: "סלון דנה", whatsappPhoneNumberId: null, blockedAt: null, subscriptionPlan: "standard", sharedLineCode: "ab3k7m" };
const demo = { id: "demo", name: "דמו", whatsappPhoneNumberId: null, blockedAt: null, subscriptionPlan: "standard", sharedLineCode: null };
const businesses: Record<string, unknown> = { salon, demo };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TORI_DEMO_BUSINESS_ID;
  process.env.TORI_SHARED_WHATSAPP_NUMBER = "972-50-000-0000";
  getHistory.mockResolvedValue([]);
  mockPrisma.conversationMessage.findMany.mockResolvedValue([]);
  mockPrisma.business.findUnique.mockImplementation(async ({ where }: { where: { id?: string; sharedLineCode?: string } }) => {
    if (where.id) return businesses[where.id] ?? null;
    if (where.sharedLineCode) return Object.values(businesses).find((b) => (b as { sharedLineCode: string | null }).sharedLineCode === where.sharedLineCode) ?? null;
    return null;
  });
});

describe("parseSharedCode", () => {
  it("reads the code out of the pre-filled first message, whatever the case", () => {
    expect(parseSharedCode("היי, רוצה לקבוע תור אצל סלון דנה #ab3k7m")).toBe("ab3k7m");
    expect(parseSharedCode("#AB3K7M")).toBe("ab3k7m");
    expect(parseSharedCode("מחר ב-10")).toBeNull();
    expect(parseSharedCode("#ab3k7m9")).toBeNull(); // seven characters is not a code
  });
});

describe("resolveSharedStranger", () => {
  it("a code names the business, and opens the thread when nothing was said before", async () => {
    const r = await resolveSharedStranger("972501", "היי, רוצה לקבוע תור אצל סלון דנה #ab3k7m");
    expect(r?.business.id).toBe("salon");
    expect(r?.opening).toBe(true);
  });

  it("a code wins over a live thread with another business", async () => {
    mockPrisma.conversationMessage.findMany.mockResolvedValue([{ businessId: "demo" }]);
    const r = await resolveSharedStranger("972501", "#ab3k7m");
    expect(r?.business.id).toBe("salon");
  });

  it("ignores a code whose business has its own number, is blocked, or has no bot on its plan", async () => {
    for (const bad of [
      { ...salon, whatsappPhoneNumberId: "own-line" },
      { ...salon, blockedAt: new Date() },
      { ...salon, subscriptionPlan: "receipts" },
    ]) {
      businesses.salon = bad;
      expect(await resolveSharedStranger("972501", "#ab3k7m")).toBeNull();
    }
    businesses.salon = salon;
  });

  it("'דמו' reaches the demo business when one is configured", async () => {
    process.env.TORI_DEMO_BUSINESS_ID = "demo";
    expect((await resolveSharedStranger("972501", "דמו"))?.business.id).toBe("demo");
    delete process.env.TORI_DEMO_BUSINESS_ID;
    expect(await resolveSharedStranger("972501", "דמו")).toBeNull();
  });

  it("remembers a returning customer by their last shared-line conversation", async () => {
    mockPrisma.conversationMessage.findMany.mockResolvedValue([{ businessId: "salon" }]);
    getHistory.mockResolvedValue([{ role: "user", content: "x" }]);
    const r = await resolveSharedStranger("972501", "היי, אפשר שוב תור לשבוע הבא?");
    expect(r?.business.id).toBe("salon");
    expect(r?.opening).toBe(false);
    const where = mockPrisma.conversationMessage.findMany.mock.calls[0][0].where;
    expect(where.phone).toBe("972501");
    expect(where.createdAt.gte.getTime()).toBeGreaterThan(Date.now() - 91 * 24 * 3600 * 1000);
  });

  it("skips a remembered business that has since connected its own number", async () => {
    businesses.other = { ...salon, id: "other", whatsappPhoneNumberId: "own", sharedLineCode: null };
    mockPrisma.conversationMessage.findMany.mockResolvedValue([{ businessId: "other" }, { businessId: "salon" }]);
    expect((await resolveSharedStranger("972501", "היי"))?.business.id).toBe("salon");
    delete businesses.other;
  });

  it("remembers the demo only while its thread is live", async () => {
    process.env.TORI_DEMO_BUSINESS_ID = "demo";
    mockPrisma.conversationMessage.findMany.mockResolvedValue([{ businessId: "demo" }]);
    getHistory.mockResolvedValue([]); // idle past the bot's own reset
    expect(await resolveSharedStranger("972501", "כן, מעניין אותי")).toBeNull();
    getHistory.mockResolvedValue([{ role: "user", content: "דמו" }]);
    expect((await resolveSharedStranger("972501", "10:00"))?.business.id).toBe("demo");
  });

  it("a stranger with no code, no demo and no history is nobody's customer", async () => {
    expect(await resolveSharedStranger("972501", "מעניין אותי")).toBeNull();
  });
});

describe("codes and links", () => {
  it("generates six characters without the ones that look alike", () => {
    for (let i = 0; i < 50; i++) expect(generateSharedCode()).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{6}$/);
  });

  it("mints a code once and keeps it", async () => {
    mockPrisma.business.findUnique.mockResolvedValueOnce({ sharedLineCode: null });
    mockPrisma.business.update.mockResolvedValue({});
    const code = await ensureSharedLineCode("salon");
    expect(code).toHaveLength(6);
    expect(mockPrisma.business.update).toHaveBeenCalledWith({ where: { id: "salon" }, data: { sharedLineCode: code } });

    mockPrisma.business.findUnique.mockResolvedValueOnce({ sharedLineCode: "kept00" });
    expect(await ensureSharedLineCode("salon")).toBe("kept00");
  });

  it("builds a wa.me link with the business named and the code in the message, or none without a number", () => {
    const link = sharedLineLink("ab3k7m", "סלון דנה")!;
    expect(link.startsWith("https://wa.me/972500000000?text=")).toBe(true);
    expect(decodeURIComponent(link.split("text=")[1])).toBe("היי, רוצה לקבוע תור אצל סלון דנה #ab3k7m");
    delete process.env.TORI_SHARED_WHATSAPP_NUMBER;
    expect(sharedLineLink("ab3k7m", "סלון דנה")).toBeNull();
  });
});
