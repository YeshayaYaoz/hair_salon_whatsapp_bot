import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * "Send Uri a link for ₪300": the link is created on the business's provider with the request id
 * as reference, reaches the customer by text or template, and on the callback is settled with a
 * receipt. Each half used to be impossible: there was no such tool, and the webhook knew only
 * deposits.
 */
const mockPrisma = {
  business: { findUniqueOrThrow: vi.fn() },
  paymentRequest: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findFirst: vi.fn() },
  receipt: { create: vi.fn(), update: vi.fn() },
};
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("./crypto.js", () => ({ decryptSecret: (v: string) => `dec:${v}` }));
vi.mock("./errorMonitoring.js", () => ({ captureError: vi.fn() }));
const createPaymentLink = vi.fn();
vi.mock("./payments/index.js", () => ({
  getPaymentProvider: () => ({ createPaymentLink: (...a: unknown[]) => createPaymentLink(...a) }),
  depositCallbackUrl: () => "https://backend/webhook/payments/payplus/b1/secret",
}));
const sendWhatsAppMessage = vi.fn();
const sendWhatsAppTemplate = vi.fn();
vi.mock("../webhook/whatsappClient.js", () => {
  class WhatsAppSendError extends Error { constructor(public status: number, public code: number) { super(`${status}/${code}`); } }
  return { RE_ENGAGEMENT_ERROR_CODE: 131047, WhatsAppSendError, sendWhatsAppMessage: (...a: unknown[]) => sendWhatsAppMessage(...a), sendWhatsAppTemplate: (...a: unknown[]) => sendWhatsAppTemplate(...a) };
});
const issueAndSendReceipt = vi.fn();
const deliverReceipt = vi.fn();
vi.mock("./receipts.js", () => ({
  issueAndSendReceipt: (...a: unknown[]) => issueAndSendReceipt(...a),
  deliverReceipt: (...a: unknown[]) => deliverReceipt(...a),
  NoInvoiceProviderError: class extends Error {},
}));
const resolveInvoiceCredentials = vi.fn();
vi.mock("./invoices/index.js", () => ({ resolveInvoiceCredentials: (...a: unknown[]) => resolveInvoiceCredentials(...a) }));
const notifyOwner = vi.fn();
vi.mock("./ownerNotify.js", () => ({ notifyOwner: (...a: unknown[]) => notifyOwner(...a) }));

const { createPaymentRequest, settlePaymentRequest, NoPaymentProviderError } = await import("./paymentRequests.js");
const { WhatsAppSendError } = await import("../webhook/whatsappClient.js");

const business = { id: "b1", name: "Kestech", paymentProvider: "payplus", paymentApiKey: "k", paymentApiSecret: "s", paymentPageUid: "page", paymentWebhookSecret: "secret", whatsappPhoneNumberId: "pn", whatsappAccessToken: "tok" };
const customer = { id: "c1", name: "אורי לוי", phone: "972501111111" };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business);
  mockPrisma.paymentRequest.create.mockResolvedValue({ id: "pr1" });
  mockPrisma.paymentRequest.update.mockResolvedValue({});
  mockPrisma.paymentRequest.delete.mockResolvedValue({});
  createPaymentLink.mockResolvedValue({ paymentUrl: "https://payplus/pay/x", providerTransactionId: "uid1" });
  sendWhatsAppMessage.mockResolvedValue({});
});

describe("createPaymentRequest", () => {
  it("creates the link with the request id as reference and sends it to the customer", async () => {
    const out = await createPaymentRequest({ businessId: "b1", customer, amountIls: 300, description: "בדיקה" });

    expect(createPaymentLink.mock.calls[0][1]).toMatchObject({ amountIls: 300, referenceId: "pr1", customerPhone: customer.phone, callbackUrl: expect.stringContaining("/webhook/payments/") });
    expect(out).toMatchObject({ requestId: "pr1", paymentUrl: "https://payplus/pay/x", delivery: "sent" });
    expect(sendWhatsAppMessage.mock.calls[0][0].text).toContain("https://payplus/pay/x");
    expect(sendWhatsAppMessage.mock.calls[0][0].text).toContain("₪300");
  });

  it("promises the automatic receipt only when an invoicing provider is connected", async () => {
    resolveInvoiceCredentials.mockReturnValue(null);
    await createPaymentRequest({ businessId: "b1", customer, amountIls: 300, description: "בדיקה" });
    expect(sendWhatsAppMessage.mock.calls[0][0].text).not.toContain("הקבלה");

    resolveInvoiceCredentials.mockReturnValue({ provider: "greeninvoice", credentials: {} });
    await createPaymentRequest({ businessId: "b1", customer, amountIls: 300, description: "בדיקה" });
    expect(sendWhatsAppMessage.mock.calls[1][0].text).toContain("הקבלה תגיע אליך");
  });

  it("falls back to the template with the request id on the button when the window is closed", async () => {
    sendWhatsAppMessage.mockRejectedValue(new WhatsAppSendError(400, 131047));
    sendWhatsAppTemplate.mockResolvedValue({});

    const out = await createPaymentRequest({ businessId: "b1", customer, amountIls: 300, description: "בדיקה" });

    expect(out.delivery).toBe("template");
    expect(sendWhatsAppTemplate.mock.calls[0][0]).toMatchObject({ templateName: "tori_payment_request", urlSuffix: "pr1", bodyParams: ["אורי", "Kestech", "בדיקה", "300"] });
  });

  it("refuses without a payment provider, and leaves no row behind when the provider refuses", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ ...business, paymentProvider: null });
    await expect(createPaymentRequest({ businessId: "b1", customer, amountIls: 300, description: "x" })).rejects.toBeInstanceOf(NoPaymentProviderError);

    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business);
    createPaymentLink.mockRejectedValue(new Error("PayPlus rejected the request: bad page uid"));
    await expect(createPaymentRequest({ businessId: "b1", customer, amountIls: 300, description: "x" })).rejects.toThrow(/bad page uid/);
    expect(mockPrisma.paymentRequest.delete).toHaveBeenCalledWith({ where: { id: "pr1" } });
  });
});

describe("settlePaymentRequest", () => {
  const pending = { id: "pr1", businessId: "b1", status: "pending", amountIls: 300, description: "בדיקה", customer };

  it("ignores a reference that is not a pending request of this business", async () => {
    mockPrisma.paymentRequest.findFirst.mockResolvedValue(null);
    expect(await settlePaymentRequest("b1", "appt-id", { amountIls: 300 })).toBe(false);
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it("marks it paid, issues the receipt through the invoicing provider, and tells the owner", async () => {
    mockPrisma.paymentRequest.findFirst.mockResolvedValue(pending);
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ ...business, invoiceProvider: "greeninvoice" });
    resolveInvoiceCredentials.mockReturnValue({ provider: "greeninvoice", credentials: {} });
    issueAndSendReceipt.mockResolvedValue({ receiptId: "r1", documentUrl: "https://doc/1", delivery: "sent" });

    expect(await settlePaymentRequest("b1", "pr1", { amountIls: 300 })).toBe(true);

    expect(mockPrisma.paymentRequest.update).toHaveBeenCalledWith({ where: { id: "pr1" }, data: expect.objectContaining({ status: "paid" }) });
    expect(issueAndSendReceipt.mock.calls[0][0]).toMatchObject({ businessId: "b1", amountIls: 300, customerId: "c1", description: "בדיקה" });
    expect(notifyOwner.mock.calls[0][1]).toMatch(/אורי לוי.*₪300/);
    expect(notifyOwner.mock.calls[0][1]).toContain("https://doc/1");
  });

  it("records the receipt PayPlus Invoice+ already issued rather than issuing a second", async () => {
    mockPrisma.paymentRequest.findFirst.mockResolvedValue(pending);
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ ...business, invoiceProvider: "payplus-invoice" });
    resolveInvoiceCredentials.mockReturnValue({ provider: "payplus-invoice", credentials: {} });
    mockPrisma.receipt.create.mockResolvedValue({ id: "r2" });
    deliverReceipt.mockResolvedValue("template");

    await settlePaymentRequest("b1", "pr1", { amountIls: 300, receiptUrl: "https://payplus/doc/9" });

    expect(issueAndSendReceipt).not.toHaveBeenCalled();
    expect(mockPrisma.receipt.create.mock.calls[0][0].data).toMatchObject({ documentUrl: "https://payplus/doc/9", customerId: "c1" });
    expect(deliverReceipt.mock.calls[0][0]).toMatchObject({ receiptId: "r2", customerPhone: customer.phone });
  });

  it("does not settle on an underpayment", async () => {
    mockPrisma.paymentRequest.findFirst.mockResolvedValue(pending);
    expect(await settlePaymentRequest("b1", "pr1", { amountIls: 100 })).toBe(true);
    expect(mockPrisma.paymentRequest.update).not.toHaveBeenCalled();
  });
});
