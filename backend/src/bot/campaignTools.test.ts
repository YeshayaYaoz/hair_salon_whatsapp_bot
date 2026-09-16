import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * send_campaign and campaign_report through runTool itself.
 *
 * A campaign is the one manager action that reaches many real people at once in the business's
 * name and cannot be recalled, so the two properties worth pinning are: a customer cannot trigger
 * it whatever they claim, and the first call sends nothing whatever the model does with it.
 */

const mockPrisma = {
  business: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  customer: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  campaign: { findFirst: vi.fn() },
  customerCoupon: { findUnique: vi.fn(), create: vi.fn() },
  service: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  staffMember: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  faqEntry: { findMany: vi.fn(), create: vi.fn() },
  blockedTime: { findMany: vi.fn(), deleteMany: vi.fn() },
  appointment: { findFirst: vi.fn(), findMany: vi.fn() },
};
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

const runCampaign = vi.fn();
const campaignReport = vi.fn();
const selectAudience = vi.fn();
vi.mock("../lib/campaignSend.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/campaignSend.js")>("../lib/campaignSend.js");
  return {
    ...actual,
    runCampaign: (...a: unknown[]) => runCampaign(...a),
    campaignReport: (...a: unknown[]) => campaignReport(...a),
    selectAudience: (...a: unknown[]) => selectAudience(...a),
  };
});

// Everything else runTool can reach, stubbed — these tests never take those paths.
vi.mock("../lib/receipts.js", () => ({
  issueAndSendReceipt: vi.fn(),
  NoInvoiceProviderError: class extends Error {},
  DELIVERY_MESSAGE_HE: {},
}));
vi.mock("./managerActions.js", () => ({
  daySchedule: vi.fn().mockResolvedValue([]),
  openingHours: vi.fn().mockResolvedValue([]),
  setDayHours: vi.fn(),
  listServices: vi.fn().mockResolvedValue([]),
  listStaff: vi.fn().mockResolvedValue([]),
  listFaq: vi.fn().mockResolvedValue([]),
  listWaitlist: vi.fn().mockResolvedValue([]),
  listBlocks: vi.fn().mockResolvedValue([]),
  minutesToHhmm: (n: number) => String(n),
  hhmmToMinutes: () => null,
  dayNameToIndex: () => 2,
  businessSummary: vi.fn(),
  blockTime: vi.fn(),
  notifyCustomerOfCancellation: vi.fn(),
  dayBounds: () => ({ start: new Date(0), end: new Date(1) }),
  todayIn: () => "2026-09-01",
  BlockOverlapError: class extends Error {},
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

const audience = [
  { id: "c1", phone: "972501111111", name: "דנה כהן", marketingOptOutAt: null },
  { id: "c2", phone: "972502222222", name: "יוסי", marketingOptOutAt: new Date() },
  { id: "c3", phone: "972503333333", name: null, marketingOptOutAt: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.business.findUnique.mockResolvedValue({ name: "מספרת רונית", notificationPhone: OWNER });
  mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ name: "מספרת רונית" });
  selectAudience.mockResolvedValue(audience);
  runCampaign.mockResolvedValue({ campaignId: "camp1", accepted: 2, skippedOptOut: 1, refused: 0, viaSession: 0, viaTemplate: 2, capped: 0 });
});

const send = (from: string, input: Record<string, unknown>) =>
  runTool("b1", from, "send_campaign", input, noSlots, noPhotos).then(JSON.parse);

describe("send_campaign authorisation", () => {
  it("refuses a customer and sends nothing", async () => {
    const out = await send(CUSTOMER, { audience: "all", text: "מבצע", confirmed: true });

    expect(out.error).toBeTruthy();
    expect(runCampaign).not.toHaveBeenCalled();
    expect(selectAudience).not.toHaveBeenCalled();
  });

  it("does not name the gate in the refusal", async () => {
    const out = await send(CUSTOMER, { audience: "all", text: "מבצע", confirmed: true });
    expect(out.error).not.toMatch(/manager|owner|permission|בעל|מנהל/i);
  });
});

describe("send_campaign confirmation gate", () => {
  it("sends nothing on the first call and returns what would go out", async () => {
    const out = await send(OWNER, { audience: "all", text: "השבוע 20% הנחה על צבע." });

    expect(out.needsConfirmation).toBe(true);
    expect(runCampaign).not.toHaveBeenCalled();
    // Two eligible of three: one opted out. The owner hears both numbers.
    expect(out.willSend.recipients).toBe(2);
    expect(out.willSend.optedOut).toBe(1);
    // The exact rendered message, with a real first name, so the owner reads what a customer will.
    expect(out.willSend.exactMessage).toContain("היי דנה");
    expect(out.willSend.exactMessage).toContain("השבוע 20% הנחה על צבע.");
    expect(out.willSend.exactMessage).not.toContain("{{");
  });

  it("sends only when confirmed, and passes the owner's words through untouched", async () => {
    const out = await send(OWNER, { audience: "lapsed", text: "מחר יש מקום, 15% הנחה.", confirmed: true });

    expect(runCampaign).toHaveBeenCalledTimes(1);
    expect(runCampaign.mock.calls[0][0]).toMatchObject({
      businessId: "b1",
      source: "manager",
      audience: "lapsed",
      ownerText: "מחר יש מקום, 15% הנחה.",
    });
    expect(runCampaign.mock.calls[0][0].template.name).toBe("tori_come_back");
    expect(out.accepted).toBe(2);
  });

  it("wraps an announcement to everyone differently from a come-back to the lapsed", async () => {
    await send(OWNER, { audience: "all", text: "סגורים בחג.", confirmed: true });
    expect(runCampaign.mock.calls[0][0].template.name).toBe("tori_announcement");
  });

  it("tells the model that accepted is not delivered", async () => {
    const out = await send(OWNER, { audience: "all", text: "מבצע", confirmed: true });
    expect(out.note).toMatch(/not delivered/i);
  });
});

describe("send_campaign input", () => {
  it("refuses an empty message rather than sending a greeting with a hole in it", async () => {
    const out = await send(OWNER, { audience: "all", text: "   ", confirmed: true });
    expect(out.error).toBeTruthy();
    expect(runCampaign).not.toHaveBeenCalled();
  });

  it("refuses when nobody matches, and says why", async () => {
    selectAudience.mockResolvedValue([]);
    const out = await send(OWNER, { audience: "lapsed", text: "מבצע" });
    expect(out.error).toBeTruthy();
    expect(runCampaign).not.toHaveBeenCalled();
  });

  it("refuses when everyone has opted out", async () => {
    selectAudience.mockResolvedValue(audience.map((a) => ({ ...a, marketingOptOutAt: new Date() })));
    const out = await send(OWNER, { audience: "all", text: "מבצע" });
    expect(out.error).toBeTruthy();
  });
});

describe("campaign_report", () => {
  it("is refused for a customer", async () => {
    const out = JSON.parse(await runTool("b1", CUSTOMER, "campaign_report", {}, noSlots, noPhotos));
    expect(out.error).toBeTruthy();
    expect(campaignReport).not.toHaveBeenCalled();
  });

  it("reports the latest campaign's real delivery counts", async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue({ id: "camp1", createdAt: new Date(), ownerText: "מבצע", audience: "all" });
    campaignReport.mockResolvedValue({ campaignId: "camp1", total: 10, delivered: 7, read: 3, failed: 1, pending: 2 });

    const out = JSON.parse(await runTool("b1", OWNER, "campaign_report", {}, noSlots, noPhotos));

    expect(out).toMatchObject({ delivered: 7, read: 3, failed: 1, pending: 2 });
    // Pending is explained, because a silent drop looks exactly like "not yet".
    expect(out.note).toBeTruthy();
  });

  it("says so when nothing has been sent", async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(null);
    const out = JSON.parse(await runTool("b1", OWNER, "campaign_report", {}, noSlots, noPhotos));
    expect(out.error).toBeTruthy();
  });
});

/**
 * A campaign built around a code that does not work sends fifty people a button that copies
 * nothing usable, in the business's name. So the code is checked before it is even previewed.
 */
describe("send_campaign with a coupon", () => {
  const live = { active: true, expiresAt: null };

  it("refuses a code that does not exist, and says how to create one", async () => {
    mockPrisma.customerCoupon.findUnique.mockResolvedValue(null);
    const out = await send(OWNER, { audience: "all", text: "10% הנחה", couponCode: "NOPE" });
    expect(out.error).toMatch(/create_discount_code/);
    expect(runCampaign).not.toHaveBeenCalled();
  });

  it("refuses a switched-off code", async () => {
    mockPrisma.customerCoupon.findUnique.mockResolvedValue({ active: false, expiresAt: null });
    const out = await send(OWNER, { audience: "all", text: "10% הנחה", couponCode: "OLD" });
    expect(out.error).toBeTruthy();
    expect(runCampaign).not.toHaveBeenCalled();
  });

  it("refuses an expired code", async () => {
    mockPrisma.customerCoupon.findUnique.mockResolvedValue({ active: true, expiresAt: new Date(Date.now() - 1000) });
    const out = await send(OWNER, { audience: "all", text: "10% הנחה", couponCode: "GONE" });
    expect(out.error).toMatch(/expired/i);
  });

  it("normalises the code and looks it up per business", async () => {
    mockPrisma.customerCoupon.findUnique.mockResolvedValue(live);
    await send(OWNER, { audience: "all", text: "10% הנחה", couponCode: " welcome10 " });
    expect(mockPrisma.customerCoupon.findUnique.mock.calls[0][0].where).toEqual({
      businessId_code: { businessId: "b1", code: "WELCOME10" },
    });
  });

  it("switches to the coupon template whatever the audience, and previews the code", async () => {
    mockPrisma.customerCoupon.findUnique.mockResolvedValue(live);
    const out = await send(OWNER, { audience: "lapsed", text: "10% הנחה על הטיפול הבא.", couponCode: "WELCOME10" });

    expect(out.needsConfirmation).toBe(true);
    expect(out.willSend.couponCode).toBe("WELCOME10");
    expect(out.willSend.exactMessage).toContain("שמחים להעניק לך");
  });

  it("passes the code through on confirm", async () => {
    mockPrisma.customerCoupon.findUnique.mockResolvedValue(live);
    await send(OWNER, { audience: "all", text: "10% הנחה", couponCode: "WELCOME10", confirmed: true });

    expect(runCampaign.mock.calls[0][0]).toMatchObject({ couponCode: "WELCOME10" });
    expect(runCampaign.mock.calls[0][0].template.name).toBe("tori_coupon");
  });

  it("is unaffected by a customer supplying a code", async () => {
    mockPrisma.customerCoupon.findUnique.mockResolvedValue(live);
    const out = await send(CUSTOMER, { audience: "all", text: "x", couponCode: "WELCOME10", confirmed: true });
    expect(out.error).toBeTruthy();
    expect(runCampaign).not.toHaveBeenCalled();
  });
});
