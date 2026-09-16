import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * The two webhook halves a campaign depends on, through the real route:
 *   - the opt-out button, which must land on the Customer row and never reach the bot;
 *   - delivery statuses, which are the only thing that ever turns "accepted" into "delivered".
 */

const mockPrisma = {
  // The webhook writes every inbound message to WhatsAppInbound BEFORE acknowledging Meta, and
  // answers 503 if it cannot — so a route test that expects processing to happen must give it a
  // writable inbox. Statuses carry no wamid and skip this, which is why only the button-tap cases
  // needed it.
  whatsAppInbound: { create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
  business: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  customer: { upsert: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  campaignSend: { findUnique: vi.fn(), update: vi.fn() },
  conversationMessage: { findFirst: vi.fn(), create: vi.fn() },
  systemSetting: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
};
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/crypto.js", () => ({ decryptSecret: (v: string) => v, encryptSecret: (v: string) => v }));
vi.mock("../lib/errorMonitoring.js", () => ({ captureError: vi.fn() }));
vi.mock("../lib/rateLimit.js", () => ({ rateLimit: () => (_r: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../lib/subscriptionGate.js", () => ({ hasActiveSubscription: vi.fn(async () => true) }));
vi.mock("../lib/usageLedger.js", () => ({ logWhatsAppBillingEvent: vi.fn() }));
vi.mock("../lib/dailyMessageCap.js", () => ({ checkDailyCap: vi.fn(async () => ({ exceeded: false, justCrossed: false, count: 0 })) }));
vi.mock("../lib/ownerNotify.js", () => ({ notifyOwner: vi.fn() }));
vi.mock("../lib/email.js", () => ({ sendWhatsAppTokenExpiredEmail: vi.fn() }));
vi.mock("../lib/transcription.js", () => ({ transcribeWhatsAppVoiceNote: vi.fn(), TranscriptionNotConfiguredError: class extends Error {} }));
vi.mock("./templateStatus.js", () => ({ handleTemplateStatusUpdate: vi.fn() }));
vi.mock("../leadfinder/inboundReplies.js", () => ({ handleOutreachReply: vi.fn(), isOutreachNumber: () => false }));
vi.mock("../billing/yieldCampaignJob.js", () => ({ sendYieldCampaignOffers: vi.fn() }));
vi.mock("../bot/conversationStore.js", () => ({ clearHistory: vi.fn(), appendTurn: vi.fn() }));

const resolveBusinessByPhoneNumberId = vi.fn();
vi.mock("../tenants/resolve.js", () => ({ resolveBusinessByPhoneNumberId: (...a: unknown[]) => resolveBusinessByPhoneNumberId(...a) }));

const handleIncomingMessage = vi.fn();
vi.mock("../bot/claudeBot.js", () => ({ handleIncomingMessage: (...a: unknown[]) => handleIncomingMessage(...a) }));

const sendWhatsAppMessage = vi.fn();
vi.mock("./whatsappClient.js", () => ({
  sendWhatsAppMessage: (...a: unknown[]) => sendWhatsAppMessage(...a),
  sendWhatsAppList: vi.fn(),
  sendWhatsAppImage: vi.fn(),
  sendWhatsAppCtaUrl: vi.fn(),
  sendWhatsAppButtons: vi.fn(),
  WhatsAppAuthError: class extends Error {},
}));

const { CAMPAIGN_OPT_OUT_BUTTON } = await import("../lib/whatsappTemplates.js");

let app: express.Express;
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.WHATSAPP_APP_SECRET; // signature check skipped in dev mode
  const { whatsappRouter } = await import("./whatsappRoutes.js");
  app = express();
  app.use("/webhook/whatsapp", whatsappRouter);
  resolveBusinessByPhoneNumberId.mockResolvedValue({
    id: "b1", name: "מספרת רונית", email: "o@x.com",
    whatsappAccessToken: "tok", notificationPhone: "972509999999", pendingYieldCampaign: null, botEnabled: true,
  });
  mockPrisma.customer.upsert.mockResolvedValue({});
  mockPrisma.customer.updateMany.mockResolvedValue({ count: 1 });
  sendWhatsAppMessage.mockResolvedValue({});
});

const post = (value: Record<string, unknown>) =>
  request(app).post("/webhook/whatsapp").send({ entry: [{ changes: [{ field: "messages", value }] }] });

const buttonTap = (title: string) => ({
  metadata: { phone_number_id: "pn1" },
  messages: [{ id: "wamid.in1", from: "972501111111", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "x", title } } }],
});

describe("the opt-out button", () => {
  it("marks the customer as opted out of this business's marketing", async () => {
    await post(buttonTap(CAMPAIGN_OPT_OUT_BUTTON));
    await settle();

    expect(mockPrisma.customer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: "b1", phone: "972501111111" },
        data: { marketingOptOutAt: expect.any(Date) },
      })
    );
  });

  it("acknowledges in one line and never reaches the bot", async () => {
    // The model, shown "הסירו אותי" as a message, would answer "בטח, איך אפשר לעזור?" — an opt-out
    // request answered with a sales question.
    await post(buttonTap(CAMPAIGN_OPT_OUT_BUTTON));
    await settle();

    expect(handleIncomingMessage).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessage.mock.calls[0][0].text).toMatch(/הוסרת/);
    // Says what still comes: opting out of marketing is not opting out of their own reminders.
    expect(sendWhatsAppMessage.mock.calls[0][0].text).toMatch(/תזכורות/);
  });

  it("leaves any other button tap for the bot, as text", async () => {
    handleIncomingMessage.mockResolvedValue({ text: "ok", isFirstReply: false });
    await post(buttonTap("קביעת תור"));
    await settle();

    expect(mockPrisma.customer.updateMany).not.toHaveBeenCalled();
    expect(handleIncomingMessage).toHaveBeenCalledWith("b1", "972501111111", "קביעת תור");
  });
});

describe("delivery statuses", () => {
  const statuses = (list: Record<string, unknown>[]) => ({ metadata: { phone_number_id: "pn1" }, statuses: list });

  it("moves a campaign send from accepted to delivered", async () => {
    mockPrisma.campaignSend.findUnique.mockResolvedValue({ status: "sent" });
    await post(statuses([{ id: "wamid.c1", status: "delivered", recipient_id: "972501111111" }]));
    await settle();

    expect(mockPrisma.campaignSend.update).toHaveBeenCalledWith({
      where: { messageId: "wamid.c1" },
      data: { status: "delivered", failCode: null },
    });
  });

  it("records a failure with Meta's own error code", async () => {
    mockPrisma.campaignSend.findUnique.mockResolvedValue({ status: "sent" });
    await post(statuses([{ id: "wamid.c1", status: "failed", recipient_id: "x", errors: [{ code: 131047, title: "Re-engagement" }] }]));
    await settle();

    expect(mockPrisma.campaignSend.update.mock.calls[0][0].data).toEqual({ status: "failed", failCode: 131047 });
  });

  it("does not let a late 'delivered' overwrite 'read'", async () => {
    // Meta reports out of order. Read is the stronger fact.
    mockPrisma.campaignSend.findUnique.mockResolvedValue({ status: "read" });
    await post(statuses([{ id: "wamid.c1", status: "delivered", recipient_id: "x" }]));
    await settle();

    expect(mockPrisma.campaignSend.update).not.toHaveBeenCalled();
  });

  it("ignores statuses for messages that were not campaign sends", async () => {
    // The overwhelming majority: every bot reply, reminder and owner alert reports here too.
    mockPrisma.campaignSend.findUnique.mockResolvedValue(null);
    await post(statuses([{ id: "wamid.reply", status: "delivered", recipient_id: "x" }]));
    await settle();

    expect(mockPrisma.campaignSend.update).not.toHaveBeenCalled();
  });
});

describe("opting out by text", () => {
  const text = (body: string) => ({
    metadata: { phone_number_id: "pn1" },
    messages: [{ id: "wamid.t1", from: "972501111111", type: "text", text: { body } }],
  });

  it("honours the bare word the coupon footer asks for", async () => {
    // The coupon template's button slot is the copy-code button, so its footer says "השיבו הסר".
    await post(text("הסר"));
    await settle();

    expect(mockPrisma.customer.updateMany).toHaveBeenCalled();
    expect(handleIncomingMessage).not.toHaveBeenCalled();
  });

  it("leaves a sentence that merely contains the word for the bot", async () => {
    // "תסירי את התור שלי" is a cancellation, not an opt-out.
    handleIncomingMessage.mockResolvedValue({ text: "ok", isFirstReply: false });
    await post(text("תסירי את התור שלי מחר"));
    await settle();

    expect(mockPrisma.customer.updateMany).not.toHaveBeenCalled();
    expect(handleIncomingMessage).toHaveBeenCalled();
  });
});
