import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Tori's own line, shared by every business without a number of its own. Who is writing decides
 * everything: the owner of such a business gets their manager tools, their customer gets one line
 * and an honoured opt-out, and a prospect still reaches the lead finder.
 */
const mockPrisma = {
  whatsAppInbound: { create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
  business: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  customer: { upsert: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })), findUnique: vi.fn(async () => null) },
  receipt: { findFirst: vi.fn() },
  conversationMessage: { findFirst: vi.fn(), create: vi.fn() },
  systemSetting: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
};
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/crypto.js", () => ({ decryptSecret: (v: string) => `dec:${v}`, encryptSecret: (v: string) => v }));
vi.mock("../lib/errorMonitoring.js", () => ({ captureError: vi.fn() }));
vi.mock("../lib/rateLimit.js", () => ({ rateLimit: () => (_r: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../lib/subscriptionGate.js", () => ({ hasActiveSubscription: vi.fn(async () => true) }));
vi.mock("../lib/usageLedger.js", () => ({ logWhatsAppBillingEvent: vi.fn() }));
vi.mock("../lib/dailyMessageCap.js", () => ({ checkDailyCap: vi.fn(async () => ({ exceeded: false, justCrossed: false, count: 0 })) }));
vi.mock("../lib/ownerNotify.js", () => ({ notifyOwner: vi.fn() }));
vi.mock("../lib/email.js", () => ({ sendWhatsAppTokenExpiredEmail: vi.fn(), sendAdminAlertEmail: vi.fn() }));
vi.mock("../lib/transcription.js", () => ({ transcribeWhatsAppVoiceNote: vi.fn(), TranscriptionNotConfiguredError: class extends Error {} }));
vi.mock("./templateStatus.js", () => ({ handleTemplateStatusUpdate: vi.fn() }));
vi.mock("../billing/yieldCampaignJob.js", () => ({ sendYieldCampaignOffers: vi.fn() }));
const getHistory = vi.fn(async () => [] as unknown[]);
vi.mock("../bot/conversationStore.js", () => ({ clearHistory: vi.fn(), appendTurn: vi.fn(), getHistory: (...a: unknown[]) => getHistory(...a) }));
const noteDemoStarted = vi.fn(async () => {});
vi.mock("../lib/demoLine.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/demoLine.js")>();
  return { ...real, noteDemoStarted: (...a: unknown[]) => noteDemoStarted(...a) };
});
vi.mock("../bot/managerAuth.js", () => ({ checkManager: vi.fn(async () => ({ isManager: true })) }));

const handleOutreachReply = vi.fn();
vi.mock("../leadfinder/inboundReplies.js", async (importOriginal) => {
  // classifyReply/phoneKey stay real: the demo router uses them to keep an opt-out out of the demo.
  const real = await importOriginal<typeof import("../leadfinder/inboundReplies.js")>();
  return {
    ...real,
    handleOutreachReply: (...a: unknown[]) => handleOutreachReply(...a),
    isOutreachNumber: (id: string) => id === "tori-line",
  };
});
const handleIncomingMessage = vi.fn();
vi.mock("../bot/claudeBot.js", () => ({ handleIncomingMessage: (...a: unknown[]) => handleIncomingMessage(...a) }));
const sendWhatsAppMessage = vi.fn();
vi.mock("./whatsappClient.js", () => ({
  sendWhatsAppMessage: (...a: unknown[]) => sendWhatsAppMessage(...a),
  sendWhatsAppList: vi.fn(), sendWhatsAppImage: vi.fn(), sendWhatsAppCtaUrl: vi.fn(), sendWhatsAppButtons: vi.fn(),
  WhatsAppAuthError: class extends Error {},
}));

let app: express.Express;
const settle = () => new Promise((r) => setTimeout(r, 20));
const OWNER = "972501111111";
const receiptsBusiness = {
  id: "b1", name: "סטודיו רונית", email: "r@x.com", notificationPhone: OWNER, notificationPhoneVerifiedAt: new Date(),
  whatsappPhoneNumberId: null, whatsappAccessToken: null, subscriptionPlan: "receipts", botEnabled: true,
  pendingYieldCampaign: null, greetingButtonText: null, greetingButtonUrl: null, quickReplies: [],
};

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.TORI_DEMO_BUSINESS_ID;
  getHistory.mockResolvedValue([]);
  process.env.TORI_OUTREACH_PHONE_NUMBER_ID = "tori-line";
  process.env.TORI_OUTREACH_ACCESS_TOKEN = "tori-token";
  const { whatsappRouter } = await import("./whatsappRoutes.js");
  app = express();
  app.use("/webhook/whatsapp", whatsappRouter);
  mockPrisma.business.findMany.mockResolvedValue([]);
  mockPrisma.receipt.findFirst.mockResolvedValue(null);
  sendWhatsAppMessage.mockResolvedValue({});
  handleIncomingMessage.mockResolvedValue({ text: "יש 3 חיובים ממתינים", isFirstReply: false });
});

const post = (from: string, body: string, phoneNumberId = "tori-line") =>
  request(app).post("/webhook/whatsapp").send({
    entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ id: `wamid.${Math.random()}`, from, type: "text", text: { body } }] } }] }],
  });

describe("an owner on the shared line", () => {
  it("is resolved by their verified manager number and gets the bot, replying from Tori's line", async () => {
    mockPrisma.business.findMany.mockResolvedValue([receiptsBusiness]);

    await post(OWNER, "מי עוד לא שילם?");
    await settle();

    expect(handleIncomingMessage).toHaveBeenCalledWith("b1", OWNER, "מי עוד לא שילם?");
    expect(handleOutreachReply).not.toHaveBeenCalled();
    const reply = sendWhatsAppMessage.mock.calls[0][0];
    expect(reply).toMatchObject({ phoneNumberId: "tori-line", accessToken: "tori-token", to: OWNER });
    // Only a verified number is an identity.
    expect(mockPrisma.business.findMany.mock.calls[0][0].where).toMatchObject({ whatsappPhoneNumberId: null, notificationPhoneVerifiedAt: { not: null } });
  });
});

describe("a customer on the shared line", () => {
  it("gets one line naming the business that messaged them, and no bot", async () => {
    mockPrisma.receipt.findFirst.mockResolvedValue({ business: { id: "b1", name: "סטודיו רונית" } });

    await post("972509999999", "תודה!");
    await settle();

    expect(handleIncomingMessage).not.toHaveBeenCalled();
    expect(handleOutreachReply).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage.mock.calls[0][0].text).toContain("סטודיו רונית");
  });

  it("has an opt-out honoured against that business", async () => {
    mockPrisma.receipt.findFirst.mockResolvedValue({ business: { id: "b1", name: "סטודיו רונית" } });

    await post("972509999999", "הסר");
    await settle();

    expect(mockPrisma.customer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: "b1", phone: "972509999999" } }));
  });
});

describe("a stranger on the shared line", () => {
  it("still reaches the lead finder, as before", async () => {
    await post("972508888888", "מעניין אותי");
    await settle();

    expect(handleOutreachReply).toHaveBeenCalledWith("972508888888", "מעניין אותי");
    expect(handleIncomingMessage).not.toHaveBeenCalled();
  });
});

describe("the public demo on the shared line", () => {
  const demoBusiness = {
    ...receiptsBusiness, id: "demo", name: "סלון דנה (דמו)", notificationPhone: "972500000000",
    subscriptionPlan: "standard", botEnabled: true,
  };
  const STRANGER = "972508888888";

  beforeEach(() => {
    process.env.TORI_DEMO_BUSINESS_ID = "demo";
    mockPrisma.business.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id === "demo" ? demoBusiness : null
    );
    handleIncomingMessage.mockResolvedValue({ text: "היי! מחר פנוי ב-10:00 וב-12:30", isFirstReply: true });
  });

  it("'דמו' from a stranger opens the real bot as the demo business, from Tori's line, with the footer once", async () => {
    await post(STRANGER, "דמו");
    await settle();

    expect(handleIncomingMessage).toHaveBeenCalledWith("demo", STRANGER, "דמו");
    expect(handleOutreachReply).not.toHaveBeenCalled();
    expect(noteDemoStarted).toHaveBeenCalledWith(STRANGER, "דמו");
    const reply = sendWhatsAppMessage.mock.calls[0][0];
    expect(reply).toMatchObject({ phoneNumberId: "tori-line", accessToken: "tori-token", to: STRANGER });
    expect(reply.text).toContain("מחר פנוי");
    expect(reply.text).toContain("הדגמה של תורי");
  });

  it("keeps the thread with the demo on the next message, without re-introducing itself", async () => {
    getHistory.mockResolvedValue([{ role: "user", content: "דמו", at: new Date() }]);
    handleIncomingMessage.mockResolvedValue({ text: "קבעתי לך ל-10:00 ✅", isFirstReply: false });

    await post(STRANGER, "10:00");
    await settle();

    expect(handleIncomingMessage).toHaveBeenCalledWith("demo", STRANGER, "10:00");
    expect(noteDemoStarted).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage.mock.calls[0][0].text).not.toContain("הדגמה של תורי");
  });

  it("still hands an opt-out and a plain outreach reply to the lead finder", async () => {
    await post(STRANGER, "הסר");
    await post(STRANGER, "כן, מעניין");
    await settle();

    expect(handleOutreachReply).toHaveBeenCalledTimes(2);
    expect(handleIncomingMessage).not.toHaveBeenCalled();
  });

  it("never overrides a verified owner or a receipt customer", async () => {
    mockPrisma.receipt.findFirst.mockResolvedValue({ business: { id: "b1", name: "סטודיו רונית" } });

    await post("972509999999", "דמו");
    await settle();

    expect(handleIncomingMessage).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage.mock.calls[0][0].text).toContain("סטודיו רונית");
  });
});
