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

    // 429 / 5xx are transient — retry. 4xx (bad payload) are not.
    const transient = res.status === 429 || res.status >= 500;
    lastError = new Error(`WhatsApp send failed (${res.status}): ${body}`);
    if (transient && attempt < MAX_ATTEMPTS) {
      await sleep(500 * 2 ** (attempt - 1));
      continue;
    }
    throw lastError;
  }

  throw lastError ?? new Error("WhatsApp send failed after retries");
}
