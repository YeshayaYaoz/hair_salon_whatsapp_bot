import type { InvoiceProvider, InvoiceCredentials, CreateReceiptParams, ReceiptResult, VerifyResult } from "./types.js";
import { payplusProvider } from "../payments/payplus.js";

// PayPlus's own bundled invoicing add-on ("חשבונית+" / Invoice+). Only usable by businesses that
// are also PayPlus payment customers — it reuses the same PayPlus API key/secret pair rather than
// a separate credential (see resolve.ts), since it's the same PayPlus account, just a different
// product on it.
//
// Two things about this provider are deliberate:
//
// 1. The payment webhook does NOT call createReceipt for it. With חשבונית+ enabled, PayPlus
//    issues the receipt during the charge itself and reports its URL in the payment callback —
//    creating another document here would hand the customer two receipts for one payment.
//    createReceipt below exists for the owner-initiated manual route only.
//
// 2. The endpoint is books/docs/new/{docType}, per docs.payplus.co.il ("Create new document").
//    The previous implementation posted to Invoices/GenerateInvoice, which does not exist:
//    PayPlus answers real endpoints' bad auth with 422 "AUTHORIZATION HEADER IS NOT VALID" and
//    answered that path with the same bare 403 it gives any invented route — so every manual
//    receipt for these businesses failed since the day it shipped.
const BASE_URL = "https://restapi.payplus.co.il/api/v1.0";

export const payplusInvoiceProvider: InvoiceProvider = {
  async createReceipt(creds: InvoiceCredentials, params: CreateReceiptParams): Promise<ReceiptResult> {
    // inv_tax_receipt = חשבונית מס קבלה, the combined document the previous code intended.
    const res = await fetch(`${BASE_URL}/books/docs/new/inv_tax_receipt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Both auth conventions PayPlus uses across its API families — the JSON Authorization
        // header (payment pages, transactions) and the split headers (books, customers).
        Authorization: JSON.stringify({ api_key: creds.apiKey, secret_key: creds.apiSecret }),
        "api-key": creds.apiKey,
        "secret-key": creds.apiSecret,
      },
      body: JSON.stringify({
        customer: {
          // customer_name and email are the documented required pair; email doubles as PayPlus's
          // customer-matching key. A receipt for a phone-only walk-in still needs a name.
          customer_name: params.customerName,
          ...(params.customerEmail ? { email: params.customerEmail } : {}),
          ...(params.customerPhone ? { phone: params.customerPhone } : {}),
        },
        // Documented item shape: quantity and price are strings, vat_type 0 = price includes VAT
        // (what a customer-facing ₪ amount always is here).
        items: [{ name: params.description, quantity: "1", price: String(params.amountIls), currency_code: "ILS", vat_type: 0 }],
        currency_code: "ILS",
        language: "he",
        send_document_email: Boolean(params.customerEmail),
      }),
    });

    if (!res.ok) throw new Error(`PayPlus Invoice+ generation failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as {
      data?: { number?: string; uuid?: string; original_doc_url?: string; copy_doc_url?: string };
      results?: { status?: string; description?: string };
    };
    if (body.results?.status && body.results.status !== "success") {
      throw new Error(`PayPlus Invoice+ rejected the request: ${body.results.description ?? "unknown error"}`);
    }
    const url = body.data?.original_doc_url ?? body.data?.copy_doc_url;
    const id = body.data?.uuid ?? body.data?.number;
    if (!url || !id) throw new Error("PayPlus Invoice+ response missing the document url");
    return { documentUrl: url, providerDocumentId: String(id) };
  },

  // Same PayPlus account/credentials as the payment side — reuse its (side-effect-free) check.
  async verifyCredentials(creds: InvoiceCredentials): Promise<VerifyResult> {
    return payplusProvider.verifyCredentials(creds);
  },
};
