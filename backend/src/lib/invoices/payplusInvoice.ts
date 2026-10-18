import type { InvoiceProvider, InvoiceCredentials, CreateReceiptParams, ReceiptResult, VerifyResult, PaymentMethod } from "./types.js";
import { payplusProvider } from "../payments/payplus.js";

/**
 * PayPlus's own bundled invoicing add-on (חשבונית+ / Invoice+). Only usable by businesses that are
 * also PayPlus payment customers — it reuses the same PayPlus API key/secret pair (see resolve.ts).
 *
 * Two things about this provider are deliberate:
 *
 * 1. The payment webhook does NOT call createReceipt for it. A payment link created with
 *    initial_invoice (see payments/payplus.ts) has PayPlus issue the document itself after the
 *    charge and report it in the callback — creating another here would hand the customer two
 *    receipts for one payment. createReceipt below is for the owner-initiated manual route only.
 *
 * 2. The request body follows the "Create new document" reference at docs.payplus.co.il, as the
 *    חשבונית+ dashboard itself links it, and not an earlier guess at it. The earlier shape sent
 *    vat_type as a number, no payments array and no customer email, and read the document URL
 *    from a `data` wrapper the response does not have — so even a request PayPlus accepted came
 *    back as "response missing the document url". Field names here are the documented ones:
 *    customer.customer_name + email (both required), items[].vat_type_code, payments[] with
 *    payment_type and payment_date, and originalDocAddress / docUID in the response.
 */
const BASE_URL = "https://restapi.payplus.co.il/api/v1.0";

/** קבלה. What Green Invoice (type 300) and iCount ("receipt") issue through the same call, so the
 * document a customer gets does not change with the provider. inv_tax_receipt (חשבונית מס קבלה)
 * is the other candidate and is deliberately not used for a plain receipt. */
const DOC_TYPE_RECEIPT = "inv_receipt";

const PAYMENT_TYPE: Record<PaymentMethod, string> = {
  card: "credit-card",
  cash: "cash",
  transfer: "bank-transfer",
  app: "payment-app",
  other: "other",
};

/** Today in Israel, YYYY-MM-DD: the document's payment date. */
function todayIl(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

/**
 * PayPlus requires an email on the customer; it is also their customer-matching key. A walk-in
 * who gave only a phone still needs a receipt, so a deterministic placeholder on our own domain
 * stands in — and the document is then never emailed, only handed over on WhatsApp.
 */
function contactEmail(email: string | undefined, phone: string | undefined): { email: string; synthetic: boolean } {
  if (email) return { email, synthetic: false };
  const key = (phone ?? "unknown").replace(/\D/g, "") || "unknown";
  return { email: `customer-${key}@noemail.torionline.com`, synthetic: true };
}

export const payplusInvoiceProvider: InvoiceProvider = {
  async createReceipt(creds: InvoiceCredentials, params: CreateReceiptParams): Promise<ReceiptResult> {
    const { email, synthetic } = contactEmail(params.customerEmail, params.customerPhone);
    const amount = Math.round(params.amountIls * 100) / 100;
    const res = await fetch(`${BASE_URL}/books/docs/new/${DOC_TYPE_RECEIPT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": creds.apiKey,
        "secret-key": creds.apiSecret,
      },
      body: JSON.stringify({
        doc_date: todayIl(),
        language: "he",
        currency_code: "ILS",
        // The amount handed in is what the customer paid, VAT and all.
        vatType: "vat-type-included",
        customer: {
          // The reference lists both names; sending both costs nothing and satisfies either.
          customer_name: params.customerName,
          name: params.customerName,
          email,
          ...(params.customerPhone ? { phone: params.customerPhone } : {}),
        },
        items: [{ name: params.description, quantity: 1, price: amount, vat_type_code: "vat-type-included", currency_code: "ILS" }],
        // A receipt documents money received, so it carries the payment line — type, date, sum.
        payments: [{ payment_type: PAYMENT_TYPE[params.paymentMethod ?? "other"], payment_date: todayIl(), amount, currency_code: "ILS" }],
        totalAmount: amount,
        send_document_email: !synthetic,
        prevent_email: synthetic,
        send_document_sms: false,
      }),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`PayPlus Invoice+ generation failed (${res.status}): ${text}`);
    let body: {
      originalDocAddress?: string; copyDocAddress?: string; docUID?: string; number?: string | number; validDocumentGenerated?: boolean;
      data?: { number?: string; uuid?: string; original_doc_url?: string; copy_doc_url?: string };
      results?: { status?: string; description?: string };
      message?: string;
    };
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`PayPlus Invoice+ returned a non-JSON response: ${text.slice(0, 200)}`);
    }
    if (body.results?.status && body.results.status !== "success") {
      throw new Error(`PayPlus Invoice+ rejected the request: ${body.results.description ?? body.message ?? "unknown error"}`);
    }
    if (body.validDocumentGenerated === false) {
      throw new Error(`PayPlus Invoice+ did not generate the document: ${body.message ?? body.results?.description ?? "unknown error"}`);
    }
    // Documented shape first; the older data-wrapped one kept in case an account still answers so.
    const url = body.originalDocAddress ?? body.copyDocAddress ?? body.data?.original_doc_url ?? body.data?.copy_doc_url;
    const id = body.docUID ?? body.data?.uuid ?? body.number ?? body.data?.number;
    if (!url || id === undefined) throw new Error(`PayPlus Invoice+ response missing the document url: ${text.slice(0, 300)}`);
    return { documentUrl: url, providerDocumentId: String(id) };
  },

  // Same PayPlus account/credentials as the payment side — reuse its (side-effect-free) check.
  async verifyCredentials(creds: InvoiceCredentials): Promise<VerifyResult> {
    return payplusProvider.verifyCredentials(creds);
  },
};
