const GRAPH_VERSION = "v20.0";

interface SendCommon {
  phoneNumberId: string;
  accessToken: string;
  to: string;
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
  params: SendCommon & { bodyText: string; buttonText: string; rows: ListRow[] }
) {
  await send(params, {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: params.bodyText },
      action: {
        button: params.buttonText.slice(0, 20),
        sections: [{ title: "Available times", rows: params.rows.slice(0, 10) }],
      },
    },
  });
}

async function send(params: SendCommon, payload: Record<string, unknown>) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${params.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", to: params.to, ...payload }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${body}`);
  }
}
