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

export async function sendWhatsAppMessage(params: SendCommon & { text: string }) {
  await send(params, {
    type: "text",
    text: { body: params.text },
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
        button: params.buttonText.slice(0, 20),
        sections: [{ title: (params.sectionTitle ?? "מועדים פנויים").slice(0, 24), rows: params.rows.slice(0, 10) }],
      },
    },
  });
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
