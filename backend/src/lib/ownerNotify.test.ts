import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  business: { findUnique: vi.fn(), update: vi.fn() },
  conversationMessage: { findFirst: vi.fn() },
};
const sendWhatsAppMessage = vi.fn();
const sendWhatsAppTemplate = vi.fn();
const sendBusinessNoticeEmail = vi.fn();

vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("./crypto.js", () => ({ decryptSecret: (s: string) => `dec:${s}` }));
vi.mock("../webhook/whatsappClient.js", () => ({
  sendWhatsAppMessage: (...a: unknown[]) => sendWhatsAppMessage(...a),
  sendWhatsAppTemplate: (...a: unknown[]) => sendWhatsAppTemplate(...a),
}));
vi.mock("./email.js", () => ({ sendBusinessNoticeEmail: (...a: unknown[]) => sendBusinessNoticeEmail(...a) }));

const { notifyOwner } = await import("./ownerNotify.js");

/**
 * What this guards: Meta's send API returns 200 for a free-form message even when the recipient
 * has no open 24h window — the rejection arrives asynchronously. An owner alert died exactly this
 * way on a live call while every layer reported success, so "sent" here has to mean "deliverable",
 * not "accepted".
 */
describe("notifyOwner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WHATSAPP_OWNER_ALERT_TEMPLATE;
    mockPrisma.business.findUnique.mockResolvedValue({
      name: "בנחת רוח",
      email: "owner@zimmer.test",
      notificationPhone: "0533391353",
      notificationPhoneVerifiedAt: new Date(),
      whatsappPhoneNumberId: "pn1",
      whatsappAccessToken: "enc",
    });
    mockPrisma.business.update.mockResolvedValue({});
  });

  it("sends free-form while the owner's 24h window is open", async () => {
    mockPrisma.conversationMessage.findFirst.mockResolvedValue({ id: "m1" });
    expect(await notifyOwner("biz1", "הודעה")).toBe(true);
    expect(sendWhatsAppMessage).toHaveBeenCalled();
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
    // The window is the owner's own inbound messages, normalized to digits with country code —
    // ConversationMessage stores WhatsApp's bare sender id, not the dashboard's formatting.
    expect(mockPrisma.conversationMessage.findFirst.mock.calls[0][0].where.phone).toBe("972533391353");
  });

  it("falls back to the approved template outside the window", async () => {
    process.env.WHATSAPP_OWNER_ALERT_TEMPLATE = "owner_alert";
    mockPrisma.conversationMessage.findFirst.mockResolvedValue(null);
    expect(await notifyOwner("biz1", "הודעה")).toBe(true);
    expect(sendWhatsAppTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: "owner_alert", bodyParams: ["הודעה"] })
    );
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("falls back to the business's email outside the window with no template", async () => {
    // A free-form send here would 'succeed' at Meta's API and die in transit. The owner's answer
    // to that, verbatim, was 'I want the messages' — so the alert arrives by email rather than
    // being refused. Late beats never; a lead that arrives is a lead.
    mockPrisma.conversationMessage.findFirst.mockResolvedValue(null);
    expect(await notifyOwner("biz1", "הודעה")).toBe(true);
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
    expect(sendBusinessNoticeEmail).toHaveBeenCalledWith("owner@zimmer.test", "בנחת רוח", "הודעה");
  });

  it("still refuses when no notification phone is configured", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      notificationPhone: null, whatsappPhoneNumberId: "pn1", whatsappAccessToken: "enc",
    });
    expect(await notifyOwner("biz1", "הודעה")).toBe(false);
  });
});
