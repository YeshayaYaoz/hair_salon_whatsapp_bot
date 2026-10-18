import { describe, it, expect, vi, beforeEach } from "vitest";
import { payplusInvoiceProvider } from "./payplusInvoice.js";

/**
 * Pinned against PayPlus's "Create new document" reference — the one their חשבונית+ dashboard
 * links. The previous body was a guess at it, and the owner's first real receipt failed.
 */
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const creds = { apiKey: "k", apiSecret: "s" };

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(ok({ docUID: "d-1", number: 1042, originalDocAddress: "https://payplus/doc/1", validDocumentGenerated: true }));
});

describe("payplusInvoiceProvider.createReceipt", () => {
  it("sends the documented shape: receipt doc type, split auth headers, items, a payment line — and no VAT type", async () => {
    await payplusInvoiceProvider.createReceipt(creds, { amountIls: 300, description: "בדיקה", customerName: "אורי", customerPhone: "972501111111", paymentMethod: "cash" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://restapi.payplus.co.il/api/v1.0/books/docs/new/inv_receipt");
    expect(init.headers).toMatchObject({ "api-key": "k", "secret-key": "s" });
    const body = JSON.parse(init.body);
    // The account's own VAT regime decides; an exempt dealer's receipt must not carry VAT.
    expect(body).not.toHaveProperty("vatType");
    expect(body.items[0]).toMatchObject({ name: "בדיקה", quantity: 1, price: 300 });
    expect(body.items[0]).not.toHaveProperty("vat_type_code");
    expect(body.payments[0]).toMatchObject({ payment_type: "cash", amount: 300 });
    expect(body.payments[0].payment_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.totalAmount).toBe(300);
    expect(body.customer).toMatchObject({ customer_name: "אורי", phone: "972501111111" });
  });

  it("supplies the required email for a phone-only customer and then never emails them", async () => {
    await payplusInvoiceProvider.createReceipt(creds, { amountIls: 1, description: "x", customerName: "אורי", customerPhone: "0501111111" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.customer.email).toMatch(/^customer-0501111111@/);
    expect(body.send_document_email).toBe(false);
    expect(body.prevent_email).toBe(true);
  });

  it("emails a customer whose real address it has", async () => {
    await payplusInvoiceProvider.createReceipt(creds, { amountIls: 1, description: "x", customerName: "אורי", customerEmail: "uri@x.com" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.customer.email).toBe("uri@x.com");
    expect(body.send_document_email).toBe(true);
  });

  it("marks a card payment as such, and defaults to other", async () => {
    await payplusInvoiceProvider.createReceipt(creds, { amountIls: 1, description: "x", customerName: "a", paymentMethod: "card" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).payments[0].payment_type).toBe("credit-card");
    await payplusInvoiceProvider.createReceipt(creds, { amountIls: 1, description: "x", customerName: "a" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).payments[0].payment_type).toBe("other");
  });

  it("reads the document from the documented response", async () => {
    const out = await payplusInvoiceProvider.createReceipt(creds, { amountIls: 1, description: "x", customerName: "a" });
    expect(out).toEqual({ documentUrl: "https://payplus/doc/1", providerDocumentId: "d-1" });
  });

  it("reads the live API's shape, with the document under details", async () => {
    // Verbatim from the first real receipt, 18 Oct 2026 — issued, and then misreported as failed.
    fetchMock.mockResolvedValue(ok({
      status: "success",
      details: { doc_type: "inv_receipt", docUID: "0ba9d23b-c93b-4f72-b055-5452863a160e", number: "2001", originalDocAddress: "https://restapi.payplus.co.il/getdoc/s/o/0ba9d23b.pdf", copyDocAddress: "https://restapi.payplus.co.il/getdoc/s/c/0ba9d23b.pdf" },
    }));
    const out = await payplusInvoiceProvider.createReceipt(creds, { amountIls: 300, description: "בדיקה", customerName: "אורי" });
    expect(out).toEqual({ documentUrl: "https://restapi.payplus.co.il/getdoc/s/o/0ba9d23b.pdf", providerDocumentId: "0ba9d23b-c93b-4f72-b055-5452863a160e" });
  });

  it("treats a top-level non-success status as a refusal", async () => {
    fetchMock.mockResolvedValue(ok({ status: "error", message: "brand not configured" }));
    await expect(payplusInvoiceProvider.createReceipt(creds, { amountIls: 1, description: "x", customerName: "a" })).rejects.toThrow(/brand not configured/);
  });

  it("still reads the older data-wrapped response", async () => {
    fetchMock.mockResolvedValue(ok({ data: { uuid: "u-9", original_doc_url: "https://payplus/doc/9" }, results: { status: "success" } }));
    const out = await payplusInvoiceProvider.createReceipt(creds, { amountIls: 1, description: "x", customerName: "a" });
    expect(out).toEqual({ documentUrl: "https://payplus/doc/9", providerDocumentId: "u-9" });
  });

  it("surfaces PayPlus's own reason when the document is not generated", async () => {
    fetchMock.mockResolvedValue(ok({ validDocumentGenerated: false, message: "missing document settings" }));
    await expect(payplusInvoiceProvider.createReceipt(creds, { amountIls: 1, description: "x", customerName: "a" })).rejects.toThrow(/missing document settings/);
  });
});
