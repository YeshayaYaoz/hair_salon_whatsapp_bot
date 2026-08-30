import type { InvoiceProvider, InvoiceCredentials, CreateReceiptParams, ReceiptResult, VerifyResult } from "./types.js";
import {
  YPAY_BASE_URL,
  YPAY_RESPONSE_OK,
  ypayAccessToken,
  requestYpayToken,
  cacheYpayToken,
  ypayContactEmail,
} from "../ypayAuth.js";

/**
 * YPAY invoicing API (ypay.co.il). apiKey = client_id, apiSecret = client_secret, both issued
 * after registering for their API service.
 *
 * Docs: https://ypay.co.il/assets/files/api/ypay_api_documentation.pdf (v1.9, 03-06-2025).
 * Everything below is from that document rather than inferred, including the two constraints in
 * it that would each break a naive implementation on the first real payment — see ../ypayAuth.ts
 * for the token cache and the contact-email placeholder, both shared with the payment adapter
 * because a salon using YPAY for both holds one client_id for the two of them.
 */

/** קבלה — a receipt. Matches what Green Invoice (type 300) and iCount ("receipt") issue here, so
 *  switching provider does not silently change which tax document a salon's customers get.
 *  109 (חשבונית מס קבלה) is the other plausible value and is deliberately not used. */
const DOC_TYPE_RECEIPT = 108;

/** Payment method 4 = אשראי. Accurate rather than generic: every receipt this issues follows a
 *  card payment already cleared by PayPlus/Grow/Cardcom. YPAY has no "other" method — the list is
 *  cash/bank transfer/cheque/credit/PayPal/app — so credit is both the truthful option and the
 *  only fitting one. */
const METHOD_CREDIT_CARD = 4;

export const ypayProvider: InvoiceProvider = {
  async createReceipt(creds: InvoiceCredentials, params: CreateReceiptParams): Promise<ReceiptResult> {
    const token = await ypayAccessToken(creds);
    const { email, synthetic } = ypayContactEmail(params.customerEmail, params.customerPhone, "issue a receipt");

    const res = await fetch(`${YPAY_BASE_URL}/document`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        docType: DOC_TYPE_RECEIPT,
        // Only ever true for a real address. See ypayContactEmail.
        mail: !synthetic,
        lang: "he",
        currency: "ILS",
        contact: {
          email,
          name: params.customerName,
          ...(params.customerPhone ? { mobile: params.customerPhone } : {}),
        },
        // vatIncluded: the amount handed to this adapter is what the customer actually paid, VAT
        // and all — the same assumption iCount's `unitprice_incvat` encodes. Marking it false
        // would have YPAY add VAT on top and issue a receipt for more than was charged.
        //
        // No `name`: "The Item will be created in the system only if name value will be sent", so
        // sending one would file a new catalogue entry in the salon's item index per booking.
        items: [
          { price: params.amountIls, quantity: 1, vatIncluded: true, description: params.description },
        ],
        // Error 3022 is "Total items price not equal to total payment methods amount" — the two
        // totals are checked against each other, so this must stay in step with `items` above.
        methods: [{ type: METHOD_CREDIT_CARD, total: params.amountIls }],
      }),
    });

    if (!res.ok) throw new Error(`YPAY document creation failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as {
      url?: string;
      serial_number?: string | number;
      responseCode?: number;
      message?: string;
      errorCode?: number;
    };
    if (body.responseCode !== YPAY_RESPONSE_OK) {
      throw new Error(`YPAY rejected the document (code ${body.errorCode ?? body.responseCode}): ${body.message ?? "unknown error"}`);
    }
    if (!body.url || body.serial_number === undefined) throw new Error("YPAY response missing document URL");
    return { documentUrl: body.url, providerDocumentId: String(body.serial_number) };
  },

  /**
   * Authenticating is side-effect free — no document is created — so it is the right check, the
   * same shape greenInvoice uses.
   *
   * The subtlety is error 2002: "There is already an active token for this user". That is not a
   * credentials failure, it is proof of the opposite — only valid credentials can have a live
   * token. Reporting it as invalid would tell an owner their correct keys were wrong, and the
   * more recently they had used them, the more likely they would see it.
   */
  async verifyCredentials(creds: InvoiceCredentials): Promise<VerifyResult> {
    try {
      const body = await requestYpayToken(creds);
      if (body.access_token) {
        // Keep it rather than discard it — a freshly issued token that is thrown away is exactly
        // what makes the NEXT call hit 2002.
        cacheYpayToken(creds.apiKey, body.access_token, body.lifetime);
        return { valid: true };
      }
      if (body.errorCode === 2002) return { valid: true };
      return { valid: false, error: body.message ?? "Invalid client_id / client_secret" };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Network error" };
    }
  },
};

export { __clearYpayTokenCache } from "../ypayAuth.js";
