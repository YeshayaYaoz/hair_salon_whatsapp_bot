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
    delete process.env.WHATSAPP_OWNER_ALERT_CTA_TEMPLATE;
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

  it("does not treat a phone call as an open WhatsApp window", async () => {
    // The owner rang his own zimmer to test it. The call's transcript is written to
    // ConversationMessage as role:'user' rows under his number — identical in shape to an inbound
    // WhatsApp message — so the window check read the call as proof he was reachable on WhatsApp.
    // Meta accepted the free-form send with a 200 and dropped it (131047), and the agent told a
    // caller on the line that the host had been messaged. Nothing ever arrived.
    await notifyOwner("biz1", "הודעה");
    expect(mockPrisma.conversationMessage.findFirst.mock.calls[0][0].where.channel).toBe("whatsapp");
  });

  it("falls back to the approved template outside the window", async () => {
    process.env.WHATSAPP_OWNER_ALERT_CTA_TEMPLATE = "owner_alert_cta";
    mockPrisma.conversationMessage.findFirst.mockResolvedValue(null);
    expect(await notifyOwner("biz1", "הודעה")).toBe(true);
    expect(sendWhatsAppTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: "owner_alert_cta", bodyParams: ["הודעה"] })
    );
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("tries the default template outside the window when no env var names one", async () => {
    // The submission side files these on every business's WABA automatically at connect; reading
    // the raw env var here meant the approved template sat unused until an operator ALSO set an
    // env var, and every alert quietly took the slower email path.
    mockPrisma.conversationMessage.findFirst.mockResolvedValue(null);
    expect(await notifyOwner("biz1", "הודעה")).toBe(true);
    expect(sendWhatsAppTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: "tori_account_update", bodyParams: ["הודעה"] })
    );
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(sendBusinessNoticeEmail).not.toHaveBeenCalled();
  });

  it("prefers the template with a button, then the plain one", async () => {
    // The button is an upgrade, and an upgrade must not silence alerts for businesses that never
    // received it: one connected months ago has only the plain template approved, and Meta rejects
    // a send naming a template its WABA does not hold. So the plain one is a rung, not a relic.
    mockPrisma.conversationMessage.findFirst.mockResolvedValue(null);
    sendWhatsAppTemplate
      .mockRejectedValueOnce(new Error("(#132001) Template name does not exist"))
      .mockResolvedValueOnce(undefined);

    expect(await notifyOwner("biz1", "הודעה")).toBe(true);

    expect(sendWhatsAppTemplate.mock.calls[0][0].templateName).toBe("tori_account_update");
    expect(sendWhatsAppTemplate.mock.calls[1][0].templateName).toBe("tori_owner_alert");
    // The point of the second rung: email is slower and this business should not be pushed onto it.
    expect(sendBusinessNoticeEmail).not.toHaveBeenCalled();
  });

  it("falls back to the business's email when both template sends fail", async () => {
    // A business connected before auto-submission existed has neither template approved — Meta
    // rejects both sends (132001). The owner's answer to a lost alert, verbatim, was 'I want the messages' —
    // so it arrives by email rather than being refused. Late beats never; a lead that arrives is
    // a lead.
    mockPrisma.conversationMessage.findFirst.mockResolvedValue(null);
    sendWhatsAppTemplate.mockRejectedValue(new Error("(#132001) Template name does not exist"));
    expect(await notifyOwner("biz1", "הודעה")).toBe(true);
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(sendBusinessNoticeEmail).toHaveBeenCalledWith("owner@zimmer.test", "בנחת רוח", "הודעה");
  });

  it("reports failure when the email fallback itself fails", async () => {
    // The owner called after a live booking and said no message arrived — yet this had returned
    // true and the agent had told the caller a message was on its way. The email path was the
    // liar: with RESEND_API_KEY unset it logged and returned, and an await over silence reads
    // exactly like success. Now it throws, and 'sent' means sent.
    mockPrisma.conversationMessage.findFirst.mockResolvedValue(null);
    sendWhatsAppTemplate.mockRejectedValue(new Error("(#132001) Template name does not exist"));
    sendBusinessNoticeEmail.mockRejectedValue(new Error("RESEND_API_KEY is not set"));
    expect(await notifyOwner("biz1", "הודעה")).toBe(false);
  });

  it("still refuses when no notification phone is configured", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      notificationPhone: null, whatsappPhoneNumberId: "pn1", whatsappAccessToken: "enc",
    });
    expect(await notifyOwner("biz1", "הודעה")).toBe(false);
  });
});
