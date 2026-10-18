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
  it("sends the documented shape: receipt doc type, split auth headers, items with vat_type_code, a payment line", async () => {
    await payplusInvoiceProvider.createReceipt(creds, { amountIls: 300, description: "בדיקה", customerName: "אורי", customerPhone: "972501111111", paymentMethod: "cash" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://restapi.payplus.co.il/api/v1.0/books/docs/new/inv_receipt");
    expect(init.headers).toMatchObject({ "api-key": "k", "secret-key": "s" });
    const body = JSON.parse(init.body);
    expect(body.vatType).toBe("vat-type-included");
    expect(body.items[0]).toMatchObject({ name: "בדיקה", quantity: 1, price: 300, vat_type_code: "vat-type-included" });
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
