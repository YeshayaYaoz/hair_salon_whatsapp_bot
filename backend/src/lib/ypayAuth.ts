/**
 * Shared YPAY authentication, used by BOTH the invoice adapter (lib/invoices/ypay.ts) and the
 * payment adapter (lib/payments/ypay.ts).
 *
 * Sharing is not tidiness — it is required for correctness. YPAY's error 2002 is "There is already
 * an active token for this user", so asking for a token while one is live is an ERROR, not a
 * refresh. A salon that connects YPAY for receipts AND for clearing uses ONE client_id for both,
 * so two independent caches would each mint their own token and the second adapter to run would be
 * refused for the rest of the hour. One cache keyed on client_id means whichever adapter
 * authenticates first hands the token to the other.
 *
 * Docs: https://ypay.co.il/assets/files/api/ypay_api_documentation.pdf (v1.9, 03-06-2025).
 */

export const YPAY_BASE_URL = "https://ypay.co.il/api/v1";

/** Their success code. Any other value carries an error from the table on p.21-22. */
export const YPAY_RESPONSE_OK = 1;

/** Refresh this long before the token actually dies, so a request cannot start with 40 seconds
 *  left and arrive expired. */
const EXPIRY_MARGIN_MS = 60_000;

/** Their stated lifetime, used when the response omits or mangles `lifetime`. */
const DEFAULT_LIFETIME_MS = 60 * 60 * 1000;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export interface YpayCredentials {
  /** client_id */
  apiKey: string;
  /** client_secret */
  apiSecret: string;
}

export interface YpayTokenResponse {
  access_token?: string;
  lifetime?: number | string;
  responseCode?: number;
  errorCode?: number;
  message?: string;
  httpOk: boolean;
}

export async function requestYpayToken(creds: YpayCredentials): Promise<YpayTokenResponse> {
  const res = await fetch(`${YPAY_BASE_URL}/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: creds.apiKey, client_secret: creds.apiSecret }),
  });
  const body = (await res.json().catch(() => ({}))) as Omit<YpayTokenResponse, "httpOk">;
  return { ...body, httpOk: res.ok };
}

/** Records a token we already hold so the next caller reuses it instead of tripping 2002. */
export function cacheYpayToken(clientId: string, token: string, lifetime: number | string | undefined): void {
  // Documented in milliseconds. Falls back to their stated hour rather than treating it as immortal.
  const lifetimeMs = Number(lifetime);
  const ttl = Number.isFinite(lifetimeMs) && lifetimeMs > 0 ? lifetimeMs : DEFAULT_LIFETIME_MS;
  tokenCache.set(clientId, { token, expiresAt: Date.now() + Math.max(ttl - EXPIRY_MARGIN_MS, 0) });
}

export async function ypayAccessToken(creds: YpayCredentials): Promise<string> {
  const cached = tokenCache.get(creds.apiKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const body = await requestYpayToken(creds);
  if (!body.access_token) {
    // 2001 is bad credentials; 2002 means a token is live but we do not hold it — which happens if
    // this process restarted mid-hour. Naming it beats "general error", because the two need
    // opposite responses from whoever reads the log.
    const detail =
      body.message ??
      (body.errorCode === 2002
        ? "a token is already active for this client and cannot be reissued until it expires (up to an hour)"
        : "check client_id / client_secret");
    throw new Error(`YPAY auth failed: ${detail}`);
  }
  cacheYpayToken(creds.apiKey, body.access_token, body.lifetime);
  return body.access_token;
}

/**
 * The `contact.email` YPAY insists on (error 5002), for the common case where we do not have one.
 *
 * The placeholder is derived from the customer's PHONE, and that detail is the whole point. YPAY
 * keys contact records on email + businessID: "If there isn't any Contact with the exact Email &
 * Business Id, a new contact will be created, otherwise it will be updated". One shared dummy
 * address would therefore collapse every phone-only customer into a SINGLE contact in the salon's
 * own books, each booking overwriting the last one's name.
 *
 * .invalid is reserved by RFC 2606 precisely so it can never resolve, and callers switch `mail`
 * off whenever this is used, so nothing is ever sent to it.
 */
export function ypayContactEmail(
  customerEmail: string | undefined,
  customerPhone: string | undefined,
  context: string
): { email: string; synthetic: boolean } {
  const real = customerEmail?.trim();
  if (real) return { email: real, synthetic: false };

  const digits = customerPhone?.replace(/\D/g, "");
  if (!digits) throw new Error(`YPAY requires a customer email or phone to ${context}, and neither was supplied`);
  return { email: `${digits}@no-reply.invalid`, synthetic: true };
}

/** Test seam only — the cache is module-level and would otherwise leak between cases. */
export function __clearYpayTokenCache(): void {
  tokenCache.clear();
}
