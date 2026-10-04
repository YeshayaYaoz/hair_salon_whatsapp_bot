import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A receipt outside the 24h window used to be dropped with "forward the link yourself". It now
 * goes as the approved template, with the receipt id on the button — the whole reason the
 * Receipts plan can exist.
 */
const sendWhatsAppMessage = vi.fn();
const sendWhatsAppTemplate = vi.fn();
vi.mock("../webhook/whatsappClient.js", () => {
  class WhatsAppSendError extends Error {
    constructor(public status: number, public code: number) { super(`${status}/${code}`); }
  }
  return {
    RE_ENGAGEMENT_ERROR_CODE: 131047,
    WhatsAppSendError,
    sendWhatsAppMessage: (...a: unknown[]) => sendWhatsAppMessage(...a),
    sendWhatsAppTemplate: (...a: unknown[]) => sendWhatsAppTemplate(...a),
  };
});
vi.mock("./prisma.js", () => ({ prisma: {} }));
vi.mock("./crypto.js", () => ({ decryptSecret: (v: string) => v }));
vi.mock("./errorMonitoring.js", () => ({ captureError: vi.fn() }));

const { deliverReceipt } = await import("./receipts.js");
const { WhatsAppSendError } = await import("../webhook/whatsappClient.js");

const params = {
  business: { name: "סטודיו רונית", whatsappPhoneNumberId: "pn", whatsappAccessToken: "tok" },
  customerPhone: "972501111111",
  customerName: "דנה כהן",
  receiptId: "clxreceipt123",
  documentUrl: "https://app.greeninvoice.co.il/doc/1",
  amountIls: 350,
  description: "מנוי חודשי",
};

beforeEach(() => vi.clearAllMocks());

describe("deliverReceipt", () => {
  it("sends plain text inside the window — cheapest, and the link is right there", async () => {
    sendWhatsAppMessage.mockResolvedValue({});
    expect(await deliverReceipt(params)).toBe("sent");
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage.mock.calls[0][0].text).toContain(params.documentUrl);
  });

  it("falls back to the template with the receipt id on the button when the window is closed", async () => {
    sendWhatsAppMessage.mockRejectedValue(new WhatsAppSendError(400, 131047));
    sendWhatsAppTemplate.mockResolvedValue({});

    expect(await deliverReceipt(params)).toBe("template");

    const call = sendWhatsAppTemplate.mock.calls[0][0];
    expect(call.templateName).toBe("tori_receipt");
    expect(call.bodyParams).toEqual(["דנה", "סטודיו רונית", "מנוי חודשי", "350"]);
    expect(call.urlSuffix).toBe("clxreceipt123");
  });

  it("reports window_closed only when the template is unavailable too", async () => {
    sendWhatsAppMessage.mockRejectedValue(new WhatsAppSendError(400, 131047));
    sendWhatsAppTemplate.mockRejectedValue(new Error("132001 template not found"));
    expect(await deliverReceipt(params)).toBe("window_closed");
  });

  it("does not try the template on a real send failure", async () => {
    sendWhatsAppMessage.mockRejectedValue(new Error("network"));
    expect(await deliverReceipt(params)).toBe("failed");
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
  });
});
