import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The bound on what a trial can do to the shared line. Applies to exactly the businesses that have
 * nothing else binding them (no number, no payment, not the operator's own demo), and tells the
 * owner once: the notice to the customer is an assistant turn, so the count passes the cap on the
 * first blocked message and "just crossed" cannot fire twice.
 */
const mockPrisma = { conversationMessage: { count: vi.fn(), findFirst: vi.fn() } };
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));

const { checkSharedLineCap, sharedLineCapApplies, sharedLineTrialCap, capNoticeSentRecently, SHARED_LINE_CAP_NOTICE } =
  await import("./sharedLineCap.js");

const trial = { id: "t1", subscriptionStatus: "trial", whatsappPhoneNumberId: null };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SHARED_LINE_TRIAL_MESSAGE_CAP;
  delete process.env.TORI_DEMO_BUSINESS_ID;
  mockPrisma.conversationMessage.count.mockResolvedValue(0);
  mockPrisma.conversationMessage.findFirst.mockResolvedValue(null);
});

describe("who the cap applies to", () => {
  it("a trial on the shared line, and nobody else", () => {
    expect(sharedLineCapApplies(trial)).toBe(true);
    expect(sharedLineCapApplies({ ...trial, subscriptionStatus: "active" })).toBe(false);
    expect(sharedLineCapApplies({ ...trial, whatsappPhoneNumberId: "own-line" })).toBe(false);
    process.env.TORI_DEMO_BUSINESS_ID = "t1";
    expect(sharedLineCapApplies(trial)).toBe(false);
  });

  it("defaults to 150 and takes a sane override", () => {
    expect(sharedLineTrialCap()).toBe(150);
    process.env.SHARED_LINE_TRIAL_MESSAGE_CAP = "40";
    expect(sharedLineTrialCap()).toBe(40);
    process.env.SHARED_LINE_TRIAL_MESSAGE_CAP = "nonsense";
    expect(sharedLineTrialCap()).toBe(150);
  });
});

describe("checkSharedLineCap", () => {
  it("counts the bot's own WhatsApp replies in the last 30 days", async () => {
    mockPrisma.conversationMessage.count.mockResolvedValue(12);
    const s = await checkSharedLineCap(trial);
    expect(s).toMatchObject({ applies: true, exceeded: false, justCrossed: false, used: 12, cap: 150 });
    const where = mockPrisma.conversationMessage.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ businessId: "t1", role: "assistant", channel: "whatsapp" });
    expect(where.createdAt.gte.getTime()).toBeGreaterThan(Date.now() - 31 * 24 * 3600 * 1000);
  });

  it("is exceeded at the cap, and 'just crossed' only there", async () => {
    mockPrisma.conversationMessage.count.mockResolvedValue(150);
    expect(await checkSharedLineCap(trial)).toMatchObject({ exceeded: true, justCrossed: true });
    mockPrisma.conversationMessage.count.mockResolvedValue(151);
    expect(await checkSharedLineCap(trial)).toMatchObject({ exceeded: true, justCrossed: false });
  });

  it("never queries for a business it does not apply to", async () => {
    const s = await checkSharedLineCap({ ...trial, subscriptionStatus: "active" });
    expect(s).toMatchObject({ applies: false, exceeded: false });
    expect(mockPrisma.conversationMessage.count).not.toHaveBeenCalled();
  });
});

describe("capNoticeSentRecently", () => {
  it("is true within a day of the last notice to that customer, false after", async () => {
    mockPrisma.conversationMessage.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 3600 * 1000) });
    expect(await capNoticeSentRecently("t1", "972501")).toBe(true);
    expect(mockPrisma.conversationMessage.findFirst.mock.calls[0][0].where).toMatchObject({ businessId: "t1", phone: "972501", content: SHARED_LINE_CAP_NOTICE });
    mockPrisma.conversationMessage.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 25 * 3600 * 1000) });
    expect(await capNoticeSentRecently("t1", "972501")).toBe(false);
  });
});
