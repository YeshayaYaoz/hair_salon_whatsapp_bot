/**
 * Meta Graph calls for putting a phone number onto a WABA and getting it live on Cloud API.
 *
 * The same four steps scripts/meta-add-number.ts drives by hand, as functions the server can run
 * unattended. They are separate calls rather than one because each can fail for its own reason and
 * the caller has to know which one did — "adding failed" and "the code was wrong" need different
 * responses, and a single combined call could only report the last error.
 *
 * Nothing here holds credentials: the token is passed in. Which WABA and which token a given
 * business uses is a policy decision that belongs to the caller, not to a Graph client.
 */

const GRAPH = "https://graph.facebook.com/v23.0";

export class MetaApiError extends Error {
  readonly code?: number;
  readonly subcode?: number;
  constructor(message: string, code?: number, subcode?: number) {
    super(message);
    this.name = "MetaApiError";
    this.code = code;
    this.subcode = subcode;
  }
}

async function call(
  path: string,
  token: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const error = json.error as
    | { message?: string; error_user_msg?: string; code?: number; error_subcode?: number }
    | undefined;
  if (!res.ok || error) {
    throw new MetaApiError(
      error?.error_user_msg ?? error?.message ?? `HTTP ${res.status}`,
      error?.code,
      error?.error_subcode
    );
  }
  return json;
}

export interface WabaPhoneNumber {
  id: string;
  displayPhoneNumber: string;
  verifiedName?: string;
  status?: string;
  codeVerificationStatus?: string;
  nameStatus?: string;
}

const FIELDS = "id,display_phone_number,verified_name,status,code_verification_status,name_status";

const digitsOf = (s: string) => s.replace(/\D/g, "");

function toPhone(r: Record<string, unknown>): WabaPhoneNumber {
  return {
    id: String(r.id),
    displayPhoneNumber: String(r.display_phone_number ?? ""),
    verifiedName: r.verified_name ? String(r.verified_name) : undefined,
    status: r.status ? String(r.status) : undefined,
    codeVerificationStatus: r.code_verification_status ? String(r.code_verification_status) : undefined,
    nameStatus: r.name_status ? String(r.name_status) : undefined,
  };
}

export async function listWabaPhoneNumbers(wabaId: string, token: string): Promise<WabaPhoneNumber[]> {
  const body = await call(`/${wabaId}/phone_numbers?fields=${FIELDS}`, token);
  return ((body.data as Array<Record<string, unknown>>) ?? []).map(toPhone);
}

/** The number's row on this WABA, or null. Matched on digits — Meta formats display numbers freely. */
export async function findWabaPhoneNumber(
  wabaId: string,
  e164: string,
  token: string
): Promise<WabaPhoneNumber | null> {
  const wanted = digitsOf(e164);
  const found = (await listWabaPhoneNumbers(wabaId, token)).find(
    (p) => digitsOf(p.displayPhoneNumber) === wanted
  );
  return found ?? null;
}

export async function getPhoneNumber(phoneNumberId: string, token: string): Promise<WabaPhoneNumber> {
  return toPhone(await call(`/${phoneNumberId}?fields=${FIELDS}`, token));
}

/**
 * Puts the number on the WABA and returns its new phone_number_id.
 *
 * Idempotent by lookup rather than by Meta's own behaviour: adding a number that is already there
 * errors, and on a retry that error would look like a real failure. The display name is reviewed
 * separately from the line, so a name still pending review does not hold up verification.
 */
export async function addPhoneNumberToWaba(
  wabaId: string,
  e164: string,
  verifiedName: string,
  token: string
): Promise<string> {
  const existing = await findWabaPhoneNumber(wabaId, e164, token);
  if (existing) return existing.id;

  const digits = digitsOf(e164);
  // Israel is the only country this provisions numbers in today (the Zadarma destination is fixed
  // to an Israeli mobile range), so the country code is known rather than guessed. A wrong split
  // here is accepted by Meta and produces a number nobody can verify.
  const cc = digits.startsWith("972") ? "972" : digits.slice(0, 3);
  const body = await call(`/${wabaId}/phone_numbers`, token, {
    cc,
    phone_number: digits.slice(cc.length),
    verified_name: verifiedName,
  });
  return String(body.id);
}

/**
 * Asks Meta to deliver a verification code.
 *
 * VOICE, not SMS, is the default for a provisioned number: it is a VoIP line pointed at Cartesia,
 * and an SMS to it may never arrive — while a call is answered by the agent, whose recording the
 * code can be read out of. A number the owner brought themselves is a different situation and can
 * take SMS.
 */
export async function requestVerificationCode(
  phoneNumberId: string,
  token: string,
  method: "SMS" | "VOICE" = "VOICE",
  language = "en_US"
): Promise<void> {
  await call(`/${phoneNumberId}/request_code`, token, { code_method: method, language });
}

export async function verifyCode(phoneNumberId: string, code: string, token: string): Promise<void> {
  await call(`/${phoneNumberId}/verify_code`, token, { code });
}

/**
 * Final activation on Cloud API.
 *
 * The PIN is two-step verification, and Meta rejects a *different* PIN on any later re-registration
 * of the same number — so whatever is passed here must be stored, not regenerated.
 */
export async function registerOnCloudApi(phoneNumberId: string, pin: string, token: string): Promise<void> {
  await call(`/${phoneNumberId}/register`, token, { messaging_product: "whatsapp", pin });
}

/** Subscribes the WABA to our webhook, without which messages are accepted by Meta and never arrive. */
export async function subscribeWabaToApp(wabaId: string, token: string): Promise<void> {
  await call(`/${wabaId}/subscribed_apps`, token, {});
}
