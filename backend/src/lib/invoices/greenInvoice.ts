import type { InvoiceProvider, InvoiceCredentials, CreateReceiptParams, ReceiptResult, VerifyResult } from "./types.js";

// Green Invoice (חשבונית ירוקה) API. apiKey/apiSecret authenticate a short-lived JWT, then
// documents are created against that token. Docs: https://www.greeninvoice.co.il/api-docs
const BASE_URL = "https://api.greeninvoice.co.il/api/v1";

async function authenticate(creds: InvoiceCredentials): Promise<string> {
  const res = await fetch(`${BASE_URL}/account/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: creds.apiKey, secret: creds.apiSecret }),
  });
  if (!res.ok) throw new Error(`Green Invoice auth failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

export const greenInvoiceProvider: InvoiceProvider = {
  async createReceipt(creds: InvoiceCredentials, params: CreateReceiptParams): Promise<ReceiptResult> {
    const token = await authenticate(creds);
    const res = await fetch(`${BASE_URL}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        type: 300, // receipt (קבלה)
        client: {
          name: params.customerName,
          phone: params.customerPhone,
          emails: params.customerEmail ? [params.customerEmail] : undefined,
        },
        income: [{ description: params.description, quantity: 1, price: params.amountIls, currency: "ILS", vatType: 0 }],
        payment: [{ type: 3, price: params.amountIls, currency: "ILS" }], // 3 = other/already charged externally
      }),
    });
    if (!res.ok) throw new Error(`Green Invoice document creation failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { id: string; url?: { origin?: string } };
    if (!body.url?.origin) throw new Error("Green Invoice response missing document URL");
    return { documentUrl: body.url.origin, providerDocumentId: body.id };
  },

  // Authenticating alone has no side effects (no document is created) — a clean way to confirm
  // the key/secret pair works.
  async verifyCredentials(creds: InvoiceCredentials): Promise<VerifyResult> {
    try {
      await authenticate(creds);
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Network error" };
    }
  },
};
