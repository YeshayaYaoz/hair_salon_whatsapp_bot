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
vi.mock("../bot/conversationStore.js", () => ({ clearHistory: vi.fn(), appendTurn: vi.fn() }));
vi.mock("../bot/managerAuth.js", () => ({ checkManager: vi.fn(async () => ({ isManager: true })) }));

const handleOutreachReply = vi.fn();
vi.mock("../leadfinder/inboundReplies.js", () => ({
  handleOutreachReply: (...a: unknown[]) => handleOutreachReply(...a),
  isOutreachNumber: (id: string) => id === "tori-line",
}));
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
