import type { InvoiceProvider, InvoiceCredentials, CreateReceiptParams, ReceiptResult } from "./types.js";

// iCount API. apiKey = company id (cid), apiSecret = API token (generated in iCount ->
// Settings -> API). Docs: https://help.icount.co.il/he/articles/2691469 (doc/create).
const BASE_URL = "https://api.icount.co.il/api/v3.php";

export const icountProvider: InvoiceProvider = {
  async createReceipt(creds: InvoiceCredentials, params: CreateReceiptParams): Promise<ReceiptResult> {
    const res = await fetch(`${BASE_URL}/doc/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cid: creds.apiKey,
        api_token: creds.apiSecret,
        doctype: "receipt",
        client_name: params.customerName,
        client_phone: params.customerPhone,
        client_email: params.customerEmail,
        items: [{ description: params.description, unitprice_incvat: params.amountIls, quantity: 1 }],
      }),
    });
    if (!res.ok) throw new Error(`iCount doc/create failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { status: boolean; reason?: string; doc_url?: string; docnum?: string };
    if (!body.status) throw new Error(`iCount rejected the request: ${body.reason ?? "unknown error"}`);
    if (!body.doc_url || !body.docnum) throw new Error("iCount response missing doc_url");
    return { documentUrl: body.doc_url, providerDocumentId: body.docnum };
  },
};
