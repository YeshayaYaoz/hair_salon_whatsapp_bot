import type { InvoiceProvider, InvoiceCredentials, CreateReceiptParams, ReceiptResult, VerifyResult } from "./types.js";

/**
 * YPAY invoicing API (ypay.co.il). apiKey = client_id, apiSecret = client_secret, both issued
 * after registering for their API service.
 *
 * Docs: https://ypay.co.il/assets/files/api/ypay_api_documentation.pdf (v1.9, 03-06-2025).
 * Everything below is from that document rather than inferred, including the two constraints in
 * it that would each break a naive implementation on the first real payment — see the token cache
 * and the receipt body.
 */

const BASE_URL = "https://ypay.co.il/api/v1";

/** קבלה — a receipt. Matches what Green Invoice (type 300) and iCount ("receipt") issue here, so
 *  switching provider does not silently change which tax document a salon's customers get.
 *  109 (חשבונית מס קבלה) is the other plausible value and is deliberately not used. */
const DOC_TYPE_RECEIPT = 108;

/** Payment method 4 = אשראי. Accurate rather than generic: every receipt this issues follows a
 *  card payment already cleared by PayPlus/Grow/Cardcom. YPAY has no "other" method — the list is
 *  cash/bank transfer/cheque/credit/PayPal/app — so credit is both the truthful option and the
 *  only fitting one. */
const METHOD_CREDIT_CARD = 4;

/** Their success code. Any other value carries an error from the table on p.21-22. */
const RESPONSE_OK = 1;

/**
 * Access tokens are cached per client_id, and that is not an optimisation.
 *
 * Error 2002 is "There is already an active token for this user" — so requesting a token while
 * one is live is an ERROR, not a refresh. A provider that fetched a token per document (which is
 * what greenInvoice.ts legitimately does, because its auth has no such rule) would succeed on a
 * salon's first receipt of the hour and fail on every one after it. Tokens last an hour; this
 * holds each one until shortly before it expires.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Refresh this long before the token actually dies, so a request cannot start with 40 seconds
 *  left and arrive expired. */
const EXPIRY_MARGIN_MS = 60_000;

interface AccessTokenResponse {
  access_token?: string;
  lifetime?: number | string;
  responseCode?: number;
  errorCode?: number;
  message?: string;
}

async function requestToken(creds: InvoiceCredentials): Promise<AccessTokenResponse & { httpOk: boolean }> {
  const res = await fetch(`${BASE_URL}/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: creds.apiKey, client_secret: creds.apiSecret }),
  });
  const body = (await res.json().catch(() => ({}))) as AccessTokenResponse;
  return { ...body, httpOk: res.ok };
}

async function accessToken(creds: InvoiceCredentials): Promise<string> {
  const cached = tokenCache.get(creds.apiKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const body = await requestToken(creds);
  if (!body.access_token) {
    // 2001 is bad credentials; 2002 means a token is already live but we do not hold it — which
    // only happens if this process restarted mid-hour. Naming it beats "general error", because
    // the two need opposite responses from whoever reads the log.
    const detail = body.message ?? (body.errorCode === 2002
      ? "a token is already active for this client and cannot be reissued until it expires (up to an hour)"
      : "check client_id / client_secret");
    throw new Error(`YPAY auth failed: ${detail}`);
  }

  // Documented in milliseconds. Falls back to their stated one hour if it is missing or unparsable
  // rather than treating the token as immortal.
  const lifetimeMs = Number(body.lifetime);
  const ttl = Number.isFinite(lifetimeMs) && lifetimeMs > 0 ? lifetimeMs : 60 * 60 * 1000;
  tokenCache.set(creds.apiKey, {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(ttl - EXPIRY_MARGIN_MS, 0),
  });
  return body.access_token;
}

/**
 * YPAY marks contact.email mandatory (error 5002), and none of the three payment gateways sends
 * a customer email on its callback — PayPlus, Cardcom and Grow all report name and phone only.
 * So the common path has no address to give, and a receipt that fails to issue is worse than one
 * addressed to a placeholder.
 *
 * The placeholder is derived from the customer's phone, and that detail is the whole point.
 * YPAY keys its contact records on email + businessID: "If there isn't any Contact with the exact
 * Email & Business Id, a new contact will be created, otherwise it will be updated". One shared
 * dummy address would therefore collapse every phone-only customer into a SINGLE contact in the
 * salon's own books, each booking overwriting the last one's name. A per-phone address keeps them
 * distinct.
 *
 * .invalid is reserved by RFC 2606 precisely so it can never resolve, and `mail` is switched off
 * whenever this is used, so nothing is ever sent to it.
 */
function contactEmail(params: CreateReceiptParams): { email: string; synthetic: boolean } {
  const real = params.customerEmail?.trim();
  if (real) return { email: real, synthetic: false };

  const digits = params.customerPhone?.replace(/\D/g, "");
  if (!digits) {
    throw new Error(
      "YPAY requires a customer email or phone to issue a receipt, and neither was supplied"
    );
  }
  return { email: `${digits}@no-reply.invalid`, synthetic: true };
}

export const ypayProvider: InvoiceProvider = {
  async createReceipt(creds: InvoiceCredentials, params: CreateReceiptParams): Promise<ReceiptResult> {
    const token = await accessToken(creds);
    const { email, synthetic } = contactEmail(params);

    const res = await fetch(`${BASE_URL}/document`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        docType: DOC_TYPE_RECEIPT,
        // Only ever true for a real address. See contactEmail.
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
    if (body.responseCode !== RESPONSE_OK) {
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
      const body = await requestToken(creds);
      if (body.access_token) {
        const lifetimeMs = Number(body.lifetime);
        const ttl = Number.isFinite(lifetimeMs) && lifetimeMs > 0 ? lifetimeMs : 60 * 60 * 1000;
        // Keep it rather than discard it — a freshly issued token that is thrown away is exactly
        // what makes the NEXT call hit 2002.
        tokenCache.set(creds.apiKey, {
          token: body.access_token,
          expiresAt: Date.now() + Math.max(ttl - EXPIRY_MARGIN_MS, 0),
        });
        return { valid: true };
      }
      if (body.errorCode === 2002) return { valid: true };
      return { valid: false, error: body.message ?? "Invalid client_id / client_secret" };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Network error" };
    }
  },
};

/** Test seam only — the cache is module-level and would otherwise leak between cases. */
export function __clearYpayTokenCache(): void {
  tokenCache.clear();
}
