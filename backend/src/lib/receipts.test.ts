import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = { business: { findUniqueOrThrow: vi.fn() } };
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("./crypto.js", () => ({ decryptSecret: (s: string) => `dec(${s})` }));
vi.mock("./errorMonitoring.js", () => ({ captureError: vi.fn() }));

const createReceipt = vi.fn();
const resolveInvoiceCredentials = vi.fn();
vi.mock("./invoices/index.js", () => ({
  getInvoiceProvider: () => ({ createReceipt: (...a: unknown[]) => createReceipt(...a) }),
  resolveInvoiceCredentials: (...a: unknown[]) => resolveInvoiceCredentials(...a),
}));

const sendWhatsAppMessage = vi.fn();
class WhatsAppSendError extends Error {
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}
vi.mock("../webhook/whatsappClient.js", () => ({
  sendWhatsAppMessage: (...a: unknown[]) => sendWhatsAppMessage(...a),
  RE_ENGAGEMENT_ERROR_CODE: 131047,
  WhatsAppSendError,
}));

const { issueAndSendReceipt, NoInvoiceProviderError } = await import("./receipts.js");

function business(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    name: "מספרת רונית",
    invoiceProvider: "greeninvoice",
    invoiceApiKey: "k",
    invoiceApiSecret: "s",
    paymentProvider: null,
    paymentApiKey: null,
    paymentApiSecret: null,
    paymentPageUid: null,
    whatsappPhoneNumberId: "pn1",
    whatsappAccessToken: "tok",
    ...overrides,
  };
}

const args = {
  businessId: "b1",
  amountIls: 200,
  description: "תספורת וצבע",
  customerName: "דנה כהן",
  customerPhone: "972501234567",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business());
  resolveInvoiceCredentials.mockReturnValue({ provider: "greeninvoice", credentials: { apiKey: "k", apiSecret: "s" } });
  createReceipt.mockResolvedValue({ documentUrl: "https://inv.example/doc/1" });
  sendWhatsAppMessage.mockResolvedValue(undefined);
});

describe("issueAndSendReceipt", () => {
  it("issues the document and sends it to the customer", async () => {
    const result = await issueAndSendReceipt(args);

    expect(result).toEqual({ documentUrl: "https://inv.example/doc/1", delivery: "sent" });
    const sent = sendWhatsAppMessage.mock.calls[0][0];
    expect(sent).toMatchObject({ phoneNumberId: "pn1", accessToken: "dec(tok)", to: "972501234567" });
    // The link is the point of the message — a receipt notification without it is worthless.
    expect(sent.text).toContain("https://inv.example/doc/1");
    expect(sent.text).toContain("200");
  });

  it("reports a closed 24h window separately from a real failure", async () => {
    // Meta blocks free-form messages to a customer who hasn't written in 24h. That is not our bug,
    // and the owner needs to be told to forward the link rather than that something broke.
    sendWhatsAppMessage.mockRejectedValue(new WhatsAppSendError("re-engagement", 131047));

    const result = await issueAndSendReceipt(args);

    expect(result.delivery).toBe("window_closed");
    expect(result.documentUrl).toBe("https://inv.example/doc/1");
  });

  it("still returns the document when the send fails outright", async () => {
    // The document exists at the provider and counts for the books whatever happened on WhatsApp.
    sendWhatsAppMessage.mockRejectedValue(new Error("network"));

    const result = await issueAndSendReceipt(args);

    expect(result).toMatchObject({ documentUrl: "https://inv.example/doc/1", delivery: "failed" });
  });

  it("skips delivery when the business has no WhatsApp connected", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      business({ whatsappPhoneNumberId: null, whatsappAccessToken: null })
    );

    const result = await issueAndSendReceipt(args);

    expect(result.delivery).toBe("no_whatsapp");
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("skips delivery when there is no customer phone", async () => {
    const result = await issueAndSendReceipt({ ...args, customerPhone: undefined });

    expect(result.delivery).toBe("no_whatsapp");
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("refuses before charging anything when no provider is connected", async () => {
    resolveInvoiceCredentials.mockReturnValue(null);

    await expect(issueAndSendReceipt(args)).rejects.toBeInstanceOf(NoInvoiceProviderError);
    expect(createReceipt).not.toHaveBeenCalled();
  });

  it("does not send anything when the document could not be created", async () => {
    // Otherwise a customer gets a message about a receipt that does not exist.
    createReceipt.mockRejectedValue(new Error("provider rejected"));

    await expect(issueAndSendReceipt(args)).rejects.toThrow("provider rejected");
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });
});
