import type { InvoiceProvider, InvoiceCredentials, CreateReceiptParams, ReceiptResult, VerifyResult } from "./types.js";
import { payplusProvider } from "../payments/payplus.js";

// PayPlus's own bundled invoicing add-on ("חשבונית+" / Invoice+). Only usable by businesses that
// are also PayPlus payment customers — it reuses the same PayPlus API key/secret pair rather than
// a separate credential (see resolve.ts), since it's the same PayPlus account, just a different
// product on it. Docs: https://restapidoc.payplus.co.il (Invoices/GenerateInvoice).
const BASE_URL = "https://restapi.payplus.co.il/api/v1.0";

export const payplusInvoiceProvider: InvoiceProvider = {
  async createReceipt(creds: InvoiceCredentials, params: CreateReceiptParams): Promise<ReceiptResult> {
    const res = await fetch(`${BASE_URL}/Invoices/GenerateInvoice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: JSON.stringify({ api_key: creds.apiKey, secret_key: creds.apiSecret }),
      },
      body: JSON.stringify({
        invoice_type: 1, // receipt-tax invoice (חשבונית מס/קבלה)
        customer: {
          customer_name: params.customerName,
          phone: params.customerPhone,
          email: params.customerEmail,
        },
        items: [{ name: params.description, quantity: 1, price: params.amountIls }],
      }),
    });

    if (!res.ok) throw new Error(`PayPlus Invoice+ generation failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { data?: { invoice_url?: string; invoice_uid?: string }; results?: { status?: string; description?: string } };
    if (body.results?.status && body.results.status !== "success") {
      throw new Error(`PayPlus Invoice+ rejected the request: ${body.results.description ?? "unknown error"}`);
    }
    if (!body.data?.invoice_url || !body.data?.invoice_uid) {
      throw new Error("PayPlus Invoice+ response missing invoice_url");
    }
    return { documentUrl: body.data.invoice_url, providerDocumentId: body.data.invoice_uid };
  },

  // Same PayPlus account/credentials as the payment side — reuse its (side-effect-free) check.
  async verifyCredentials(creds: InvoiceCredentials): Promise<VerifyResult> {
    return payplusProvider.verifyCredentials(creds);
  },
};
