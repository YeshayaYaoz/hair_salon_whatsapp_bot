import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  business: { findUniqueOrThrow: vi.fn() },
  conversationMessage: { findFirst: vi.fn() },
  campaign: { create: vi.fn() },
  campaignSend: { create: vi.fn(), groupBy: vi.fn() },
  customer: { findMany: vi.fn() },
};
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("./crypto.js", () => ({ decryptSecret: (v: string) => v }));
vi.mock("./phone.js", () => ({ normalizePhone: (v: string) => v }));

const sendWhatsAppMessage = vi.fn();
const sendWhatsAppTemplate = vi.fn();
vi.mock("../webhook/whatsappClient.js", () => ({
  sendWhatsAppMessage: (...a: unknown[]) => sendWhatsAppMessage(...a),
  sendWhatsAppTemplate: (...a: unknown[]) => sendWhatsAppTemplate(...a),
}));
const meterOutboundMessage = vi.fn();
vi.mock("./wallet.js", () => ({ meterOutboundMessage: (...a: unknown[]) => meterOutboundMessage(...a) }));

const { runCampaign, campaignReport, renderCampaignText, MAX_CAMPAIGN_RECIPIENTS } = await import("./campaignSend.js");
const { CAMPAIGN_COME_BACK, CAMPAIGN_ANNOUNCEMENT, CAMPAIGN_COUPON } = await import("./whatsappTemplates.js");

/**
 * The single path every marketing send takes. The yield campaign used to do this by hand and got
 * all of it wrong at once: free-form text to people outside the 24h window (every one dropped after
 * a 200), no opt-out, "sent 12" for twelve messages nobody received. Each of those is a test here.
 */
const recipient = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  phone: "972501111111",
  name: "דנה כהן",
  marketingOptOutAt: null,
  ...over,
});

const base = () => ({
  businessId: "b1",
  source: "manager" as const,
  audience: "all" as const,
  template: CAMPAIGN_ANNOUNCEMENT,
  ownerText: "השבוע 20% הנחה על צבע.",
  recipients: [recipient()],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => { fn(); return 0 as never; }) as never);
  mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ name: "מספרת רונית", whatsappPhoneNumberId: "pn", whatsappAccessToken: "tok" });
  mockPrisma.campaign.create.mockResolvedValue({ id: "camp1" });
  mockPrisma.campaignSend.create.mockResolvedValue({});
  mockPrisma.conversationMessage.findFirst.mockResolvedValue(null); // window closed by default
  sendWhatsAppMessage.mockResolvedValue({ messageId: "wamid.session" });
  sendWhatsAppTemplate.mockResolvedValue({ messageId: "wamid.template" });
  meterOutboundMessage.mockResolvedValue({});
});

describe("choosing the channel", () => {
  it("uses the approved template when the customer's 24h window is closed", async () => {
    const out = await runCampaign(base());

    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(out.viaTemplate).toBe(1);
    // The three positional parameters, in the library's fixed order.
    expect(sendWhatsAppTemplate.mock.calls[0][0]).toMatchObject({
      templateName: "tori_announcement",
      bodyParams: ["דנה", "מספרת רונית", "השבוע 20% הנחה על צבע."],
    });
  });

  it("sends plain text when the window is open — no template needed, cheaper at Meta", async () => {
    mockPrisma.conversationMessage.findFirst.mockResolvedValue({ id: "m1" });

    const out = await runCampaign(base());

    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
    expect(out.viaSession).toBe(1);
    // Same words either way: the customer must not be able to tell which channel carried it.
    expect(sendWhatsAppMessage.mock.calls[0][0].text).toBe(
      renderCampaignText(CAMPAIGN_ANNOUNCEMENT, ["דנה", "מספרת רונית", "השבוע 20% הנחה על צבע."])
    );
  });

  it("only counts a WhatsApp message as opening the window", async () => {
    await runCampaign(base());
    // A phone call's transcript lives in the same table and must not open a WhatsApp window.
    expect(mockPrisma.conversationMessage.findFirst.mock.calls[0][0].where.channel).toBe("whatsapp");
  });
});

describe("who is left out", () => {
  it("skips anyone who opted out, and says how many", async () => {
    const out = await runCampaign({
      ...base(),
      recipients: [recipient(), recipient({ id: "c2", phone: "972502222222", marketingOptOutAt: new Date() })],
    });

    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1);
    expect(out.accepted).toBe(1);
    expect(out.skippedOptOut).toBe(1);
  });

  it("caps a campaign and reports how many were cut", async () => {
    const many = Array.from({ length: MAX_CAMPAIGN_RECIPIENTS + 7 }, (_, i) =>
      recipient({ id: `c${i}`, phone: `97250${String(i).padStart(7, "0")}` })
    );

    const out = await runCampaign({ ...base(), recipients: many });

    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(MAX_CAMPAIGN_RECIPIENTS);
    expect(out.capped).toBe(7);
  });
});

describe("what gets recorded", () => {
  it("writes one row per accepted send, carrying Meta's message id", async () => {
    await runCampaign(base());

    expect(mockPrisma.campaignSend.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.campaignSend.create.mock.calls[0][0].data).toMatchObject({
      campaignId: "camp1",
      customerId: "c1",
      messageId: "wamid.template",
      channel: "template",
    });
  });

  it("records a refused send as failed rather than not at all", async () => {
    // A campaign that "reached 3 of 3" because 9 rows were never written is the lie this exists
    // to stop: the refused ones must be in the report's denominator.
    sendWhatsAppTemplate.mockRejectedValue(new Error("132001 template not found"));

    const out = await runCampaign(base());

    expect(out.accepted).toBe(0);
    expect(out.refused).toBe(1);
    const data = mockPrisma.campaignSend.create.mock.calls[0][0].data;
    expect(data.status).toBe("failed");
    expect(data.messageId).toBeFalsy();
  });

  it("keeps going after one refusal", async () => {
    sendWhatsAppTemplate.mockRejectedValueOnce(new Error("bad number")).mockResolvedValue({ messageId: "wamid.2" });

    const out = await runCampaign({ ...base(), recipients: [recipient(), recipient({ id: "c2", phone: "972502222222" })] });

    expect(out.accepted).toBe(1);
    expect(out.refused).toBe(1);
  });

  it("meters each accepted send against the plan quota", async () => {
    await runCampaign({ ...base(), recipients: [recipient(), recipient({ id: "c2", phone: "972502222222" })] });
    expect(meterOutboundMessage).toHaveBeenCalledTimes(2);
  });

  it("does not let a metering failure cost the next recipient", async () => {
    meterOutboundMessage.mockRejectedValue(new Error("db"));

    const out = await runCampaign({ ...base(), recipients: [recipient(), recipient({ id: "c2", phone: "972502222222" })] });

    expect(out.accepted).toBe(2);
  });
});

describe("rendering", () => {
  it("fills all three variables and uses only the first name", () => {
    const text = renderCampaignText(CAMPAIGN_COME_BACK, ["דנה", "מספרת רונית", "מחר יש מקום."]);
    expect(text).toBe("היי דנה, עבר זמן מאז הביקור האחרון שלך במספרת רונית. מחר יש מקום. נשמח לראותך שוב!");
    expect(text).not.toContain("{{");
  });

  it("greets a customer with no saved name without a hole in the sentence", async () => {
    await runCampaign({ ...base(), recipients: [recipient({ name: null })] });
    expect(sendWhatsAppTemplate.mock.calls[0][0].bodyParams[0]).toBe("היי");
  });
});

describe("the report", () => {
  it("counts read as delivered, and accepted-with-no-status as pending", async () => {
    mockPrisma.campaignSend.groupBy.mockResolvedValue([
      { status: "sent", _count: { _all: 4 } },
      { status: "delivered", _count: { _all: 5 } },
      { status: "read", _count: { _all: 2 } },
      { status: "failed", _count: { _all: 1 } },
    ]);

    const r = await campaignReport("camp1");

    expect(r).toMatchObject({ total: 12, delivered: 7, read: 2, failed: 1, pending: 4 });
  });
});

/**
 * A coupon is the one template whose payload is not only words: the code has to reach the
 * customer whichever channel carries the message, and on the template channel it has to reach
 * them the way WhatsApp designed for it — on a button they can tap.
 */
describe("a coupon campaign", () => {
  const coupon = () => ({ ...base(), template: CAMPAIGN_COUPON, ownerText: "10% הנחה על הטיפול הבא.", couponCode: "WELCOME10" });

  it("puts the code on the copy button when the template goes out", async () => {
    await runCampaign(coupon());

    const call = sendWhatsAppTemplate.mock.calls[0][0];
    expect(call.templateName).toBe("tori_coupon");
    expect(call.copyCode).toBe("WELCOME10");
    // And NOT in the body — the body says what it is worth, the button carries what it is.
    expect(call.bodyParams.join(" ")).not.toContain("WELCOME10");
  });

  it("puts the code in the text when the window is open, since a plain message has no button", async () => {
    mockPrisma.conversationMessage.findFirst.mockResolvedValue({ id: "m1" });

    await runCampaign(coupon());

    expect(sendWhatsAppMessage.mock.calls[0][0].text).toContain("הקוד: WELCOME10");
  });

  it("does not attach a code to a template that has no button for one", async () => {
    // A stray couponCode on an announcement must not produce a button parameter Meta rejects.
    await runCampaign({ ...base(), couponCode: "WELCOME10" });

    expect(sendWhatsAppTemplate.mock.calls[0][0].copyCode).toBeUndefined();
    expect(renderCampaignText(CAMPAIGN_ANNOUNCEMENT, ["דנה", "x", "y"], "WELCOME10")).not.toContain("WELCOME10");
  });
});
