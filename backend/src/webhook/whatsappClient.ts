const GRAPH_VERSION = "v20.0";

interface SendCommon {
  phoneNumberId: string;
  accessToken: string;
  to: string;
}

/** Thrown when WhatsApp rejects the access token (expired/invalid). Callers can alert the owner. */
export class WhatsAppAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppAuthError";
  }
}

/**
 * Thrown when WhatsApp rejects a send for a non-auth reason. Exposes Meta's numeric error code
 * so callers can branch on it — most importantly 131047 ("re-engagement message"), which means
 * the 24-hour customer service window is closed and a free-form message can't be delivered; the
 * caller should retry with an approved template instead.
 */
export class WhatsAppSendError extends Error {
  code?: number;
  status: number;
  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = "WhatsAppSendError";
    this.status = status;
    this.code = code;
  }
}

/** Meta error code: recipient is outside the 24h window, free-form messages are blocked. */
export const RE_ENGAGEMENT_ERROR_CODE = 131047;

/**
 * Send a pre-approved template message. Unlike free-form text, templates can be delivered outside
 * the 24-hour customer service window — this is how appointment reminders/reviews reach customers
 * who haven't messaged recently. The template (name + language + body variable order) must already
 * be approved in the sending WABA; see whatsappTemplates.ts for the naming contract.
 */
export async function sendWhatsAppTemplate(
  params: SendCommon & { templateName: string; languageCode: string; bodyParams: string[] }
) {
  await send(params, {
    type: "template",
    template: {
      name: params.templateName,
      language: { code: params.languageCode },
      components: params.bodyParams.length
        ? [{ type: "body", parameters: params.bodyParams.map((text) => ({ type: "text", text })) }]
        : [],
    },
  });
}

/**
 * Trims to one of WhatsApp's limits without cutting a character in half.
 *
 * slice() counts UTF-16 code units and an emoji is two of them, so a body that lands exactly on one
 * gets split into a lone surrogate — which renders as the replacement glyph, on the greeting that
 * is often a customer's first contact. Iterating the string yields whole code points instead.
 *
 * The trailing strip handles the other half of the problem: a joined emoji (family, flags) is several
 * code points glued by ZWJ or a variation selector, and stopping mid-sequence leaves a joiner with
 * nothing left to join to.
 */
export function trimToLimit(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  for (const char of text) {
    if (out.length + char.length > max) break;
    out += char;
  }
  return out.replace(/[\u200d\ufe0f]+$/u, "");
}

export async function sendWhatsAppMessage(params: SendCommon & { text: string }) {
  await send(params, {
    type: "text",
    text: { body: params.text },
  });
}

/**
 * Sends a photo by URL. Meta fetches the URL itself, so it has to be publicly reachable — a link
 * behind auth, or one that 404s, fails at Meta's end rather than ours and surfaces as a send error.
 * Caption is optional and shown under the image.
 */
export async function sendWhatsAppImage(params: SendCommon & { imageUrl: string; caption?: string }) {
  await send(params, {
    type: "image",
    image: { link: params.imageUrl, ...(params.caption ? { caption: params.caption } : {}) },
  });
}

/**
 * A message whose body is followed by a tappable button that opens a URL.
 *
 * WhatsApp's own limits, all enforced by rejecting the send rather than truncating: the body is
 * capped at 1024 characters and the button label at 20. The caller trims rather than risking a
 * rejected first impression — a greeting that fails to send leaves the customer with silence.
 *
 * Only one button is allowed on a cta_url message, and it must carry an https URL.
 */
export async function sendWhatsAppCtaUrl(
  params: SendCommon & { body: string; buttonText: string; url: string; footer?: string }
) {
  await send(params, {
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: { text: trimToLimit(params.body, 1024) },
      ...(params.footer ? { footer: { text: trimToLimit(params.footer, 60) } } : {}),
      action: {
        name: "cta_url",
        parameters: { display_text: trimToLimit(params.buttonText, 20), url: params.url },
      },
    },
  });
}

/**
 * A message followed by up to three tappable reply buttons.
 *
 * Tapping one sends the button's title back as an ordinary message (see extractMessage's
 * button_reply branch), so the bot needs no special handling — the customer simply didn't have to
 * type. That is the whole value on a phone keyboard, and it also keeps the conversation inside
 * WhatsApp rather than sending them to a website.
 *
 * WhatsApp's limits, all enforced by rejecting the send: three buttons maximum, 20 characters per
 * title, and titles must be unique within a message. Trimmed here rather than risking a rejection.
 */
export async function sendWhatsAppButtons(
  params: SendCommon & { body: string; buttons: string[]; footer?: string }
) {
  const titles = params.buttons.map((b) => trimToLimit(b.trim(), 20)).filter(Boolean).slice(0, 3);
  await send(params, {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: trimToLimit(params.body, 1024) },
      ...(params.footer ? { footer: { text: trimToLimit(params.footer, 60) } } : {}),
      action: {
        // The id comes back on the reply; the title is what the customer sees and what we treat as
        // their message, so using the title as the id keeps the two from drifting apart.
        buttons: titles.map((title, i) => ({ type: "reply", reply: { id: `qr_${i}`, title } })),
      },
    },
  });
}

export interface ListRow {
  id: string;
  title: string; // max 24 chars per WhatsApp's limit
  description?: string;
}

/** Interactive list message — lets the customer tap a slot instead of typing a time back. */
export async function sendWhatsAppList(
  params: SendCommon & { bodyText: string; buttonText: string; rows: ListRow[]; sectionTitle?: string }
) {
  await send(params, {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: params.bodyText },
      action: {
        button: trimToLimit(params.buttonText, 20),
        sections: [{ title: trimToLimit(params.sectionTitle ?? "מועדים פנויים", 24), rows: params.rows.slice(0, 10) }],
      },
    },
  });
}

/**
 * Looks up the WhatsApp Business Account (WABA) ID that owns a phone number — needed to call the
 * message-template management endpoints, which are scoped to the WABA rather than the phone number.
 */
/**
 * Subscribes this app to a WABA's webhook events — without this, Meta never pushes incoming
 * message events to our webhook, even though the connection otherwise looks fully valid (token
 * works, phone number resolves). Returns whether Meta actually confirmed the subscription rather
 * than throwing, since callers use this as a health check as much as an action.
 */
export async function subscribeAppToWaba(wabaId: string, accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
    if (!res.ok || body.success !== true) {
      console.error(`[whatsapp] Subscribe app to WABA ${wabaId} failed:`, body.error?.message ?? `HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[whatsapp] Subscribe app to WABA ${wabaId} threw:`, err);
    return false;
  }
}

/**
 * Registers a phone number to the WhatsApp Cloud API. Verification (SMS/voice code) proves you own
 * the number; registration is the separate, final step that actually activates it on WhatsApp's
 * network — until it runs, the number stays "Pending": it can't send, customers messaging it get
 * silence, and no webhook events fire, even though everything else (token, WABA subscription)
 * checks out. The pin sets/uses the number's two-step verification PIN. Registering an
 * already-registered number is a benign no-op, so this is safe to call repeatedly.
 */
export async function registerPhoneNumber(phoneNumberId: string, accessToken: string, pin: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
  });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string; error_subcode?: number } };
  if (res.ok && body.success === true) return { ok: true };
  const error = body.error?.message ?? `HTTP ${res.status}`;
  console.error(`[whatsapp] Register phone number ${phoneNumberId} failed:`, error);
  return { ok: false, error };
}

export interface PhoneNumberStatus {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  code_verification_status?: string; // VERIFIED / NOT_VERIFIED / EXPIRED
  name_status?: string;
  quality_rating?: string;
  platform_type?: string; // CLOUD_API / ON_PREMISE / NOT_APPLICABLE — ON_PREMISE on a Cloud number is a legacy-flag problem
  throughput?: { level?: string };
  status?: string; // CONNECTED / PENDING / etc. — the live registration state
  error?: string;
}

/**
 * Reads Meta's live status fields for a phone number — the ground truth for "is this number
 * actually registered and live on the Cloud API". Used for diagnostics: a number can show as
 * "connected" in our own DB (token valid, WABA subscribed) yet still be PENDING/unregistered on
 * Meta's side, in which case it silently receives no inbound webhooks.
 */
export async function getPhoneNumberStatus(phoneNumberId: string, accessToken: string): Promise<PhoneNumberStatus> {
  const fields = "id,display_phone_number,verified_name,code_verification_status,name_status,quality_rating,platform_type,throughput,status";
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}?fields=${fields}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await res.json().catch(() => ({}))) as PhoneNumberStatus & { error?: { message?: string } };
  if (!res.ok) return { error: (body as any).error?.message ?? `HTTP ${res.status}` };
  return body;
}

/**
 * Lists the app IDs currently subscribed to a WABA's webhooks — confirms our app is actually on the
 * list — and any per-app override_callback_uri. An override silently routes THIS WABA's real
 * messages to a different URL than the app-level callback that Meta's "Test" button uses, which
 * looks exactly like "everything is configured but no messages arrive".
 */
export async function getSubscribedApps(
  wabaId: string,
  accessToken: string
): Promise<{ apps: string[]; overrides: string[]; error?: string }> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/subscribed_apps`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: Array<{ whatsapp_business_api_data?: { name?: string; id?: string }; override_callback_uri?: string }>;
    error?: { message?: string };
  };
  if (!res.ok) return { apps: [], overrides: [], error: body.error?.message ?? `HTTP ${res.status}` };
  const apps = (body.data ?? []).map((d) => d.whatsapp_business_api_data?.id ?? d.whatsapp_business_api_data?.name ?? "unknown");
  const overrides = (body.data ?? []).map((d) => d.override_callback_uri).filter((u): u is string => Boolean(u));
  return { apps, overrides };
}

export async function getWabaId(phoneNumberId: string, accessToken: string): Promise<string> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}?fields=whatsapp_business_account`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = (await res.json()) as { whatsapp_business_account?: { id: string }; error?: { message?: string } };
  if (!res.ok || !body.whatsapp_business_account?.id) {
    throw new Error(`Could not resolve WhatsApp Business Account for this number: ${body.error?.message ?? "unknown error"}`);
  }
  return body.whatsapp_business_account.id;
}

export interface CreateTemplateResult {
  name: string;
  submitted: boolean;
  status?: string; // Meta's initial status, typically "PENDING" pending review
  error?: string;
}

/**
 * Submits a message template for approval to a business's own WABA. Templates take up to ~24h
 * for Meta to review; this only submits the request, it does not wait for approval. Existing
 * templates with the same name+language are reported as an error by Meta ("already exists") —
 * treated as a benign no-op here since it means the template is already set up.
 */
export async function createMessageTemplate(
  wabaId: string,
  accessToken: string,
  params: { name: string; languageCode: string; bodyText: string; category?: "UTILITY" | "MARKETING" }
): Promise<CreateTemplateResult> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: params.name,
      language: params.languageCode,
      category: params.category ?? "UTILITY",
      components: [{ type: "BODY", text: params.bodyText }],
    }),
  });
  const body = (await res.json()) as { id?: string; status?: string; error?: { message?: string; error_user_msg?: string } };
  if (res.ok) return { name: params.name, submitted: true, status: body.status };

  const message = body.error?.error_user_msg ?? body.error?.message ?? "Unknown error";
  // Meta reports duplicates as an error rather than idempotently succeeding — treat "already
  // exists" as success from the caller's point of view, since the desired state is achieved.
  if (/already exists/i.test(message)) return { name: params.name, submitted: true, status: "EXISTING" };
  return { name: params.name, submitted: false, error: message };
}

/**
 * Sets a WhatsApp Business Profile picture via Meta's 3-step Resumable Upload flow:
 *   1) open an app-scoped upload session for the image,
 *   2) upload the raw bytes to that session to get a one-time file handle,
 *   3) hand the handle to the phone number's own business_profile endpoint.
 * appId is the Meta App ID the business connected through via Embedded Signup — the upload
 * session is scoped to the app, not to the business's WABA or phone number.
 */
export async function setWhatsAppProfilePicture(params: {
  phoneNumberId: string;
  accessToken: string;
  appId: string;
  imageBuffer: Buffer;
  mimeType: string;
}): Promise<void> {
  const { phoneNumberId, accessToken, appId, imageBuffer, mimeType } = params;

  const sessionRes = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${appId}/uploads?file_length=${imageBuffer.length}&file_type=${encodeURIComponent(mimeType)}`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const sessionBody = (await sessionRes.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!sessionRes.ok || !sessionBody.id) {
    throw new Error(`Could not start image upload: ${sessionBody.error?.message ?? `HTTP ${sessionRes.status}`}`);
  }

  // Note: this step authenticates with "OAuth <token>", not "Bearer <token>" like every other
  // call in this file — that's Meta's Resumable Upload API convention, not a typo.
  const uploadRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${sessionBody.id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${accessToken}`, file_offset: "0" },
    body: new Uint8Array(imageBuffer),
  });
  const uploadBody = (await uploadRes.json().catch(() => ({}))) as { h?: string; error?: { message?: string } };
  if (!uploadRes.ok || !uploadBody.h) {
    throw new Error(`Could not upload image: ${uploadBody.error?.message ?? `HTTP ${uploadRes.status}`}`);
  }

  const profileRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/whatsapp_business_profile`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", profile_picture_handle: uploadBody.h }),
  });
  if (!profileRes.ok) {
    const errBody = (await profileRes.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Could not set profile picture: ${errBody.error?.message ?? `HTTP ${profileRes.status}`}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(params: SendCommon, payload: Record<string, unknown>) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${params.phoneNumberId}/messages`;
  const MAX_ATTEMPTS = 3;

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messaging_product: "whatsapp", to: params.to, ...payload }),
      });
    } catch (netErr) {
      // Network-level failure — retry with backoff.
      lastError = netErr instanceof Error ? netErr : new Error(String(netErr));
      if (attempt < MAX_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
      continue;
    }

    if (res.ok) return;

    const body = await res.text();

    // 401/403 = bad token; retrying won't help. Surface distinctly so the owner can be alerted.
    if (res.status === 401 || res.status === 403) {
      throw new WhatsAppAuthError(`WhatsApp auth failed (${res.status}): ${body}`);
    }

    // Pull Meta's numeric error code out of the JSON body so callers can branch on it
    // (e.g. 131047 → 24h window closed → fall back to a template).
    let metaCode: number | undefined;
    try {
      metaCode = JSON.parse(body)?.error?.code;
    } catch {
      /* body wasn't JSON — leave code undefined */
    }

    // 429 / 5xx are transient — retry. 4xx (bad payload) are not.
    const transient = res.status === 429 || res.status >= 500;
    lastError = new WhatsAppSendError(`WhatsApp send failed (${res.status}): ${body}`, res.status, metaCode);
    if (transient && attempt < MAX_ATTEMPTS) {
      await sleep(500 * 2 ** (attempt - 1));
      continue;
    }
    throw lastError;
  }

  throw lastError ?? new Error("WhatsApp send failed after retries");
}
