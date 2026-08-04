/**
 * Cartesia management API — assigning a phone number to the voice agent.
 *
 * Only one agent exists for the whole product, not one per salon. Everything that differs between
 * businesses (greeting, personality, services, hours, vocabulary) is fetched at call time by
 * voiceRoutes' /context, keyed off the dialled number. So onboarding a salon is not "create an
 * agent" — it is "point one more number at the agent we already have".
 *
 * That assignment is the single manual step that silently breaks a new salon's voice line: a number
 * with no agent behind it accepts the call and hangs up immediately, with nothing in our logs
 * because the call never reaches us.
 *
 * Deliberately narrow. This is not a general Cartesia client — it does the one thing onboarding
 * needs, and anything else (provisioning numbers, importing from a carrier) stays manual, because
 * those steps involve a telephony provider and a human decision either way.
 */

const BASE_URL = "https://api.cartesia.ai";

/**
 * Pinned per Cartesia's versioning scheme: the date the integration was written and tested. Sending
 * no version, or a stale one, silently changes the error format we parse below.
 */
const API_VERSION = "2026-03-01";

export class CartesiaNotConfiguredError extends Error {
  constructor() {
    super("CARTESIA_API_KEY / CARTESIA_AGENT_ID are not set — voice number assignment is unavailable");
    this.name = "CartesiaNotConfiguredError";
  }
}

function creds(): { apiKey: string; agentId: string } {
  // Separate from CARTESIA_TOOL_SECRET, which is inbound-only: the secret Cartesia sends US when it
  // calls our tools. This key is what lets us call THEM, and it grants full account access.
  const apiKey = process.env.CARTESIA_API_KEY?.trim();
  const agentId = process.env.CARTESIA_AGENT_ID?.trim();
  if (!apiKey || !agentId) throw new CartesiaNotConfiguredError();
  return { apiKey, agentId };
}

/** Digits only, so "+972 55-507-7941" and "972555077941" compare equal. Mirrors voiceRoutes. */
function digits(phone: string): string {
  const only = phone.replace(/\D/g, "");
  return only.startsWith("0") ? `972${only.slice(1)}` : only;
}

interface CartesiaPhoneNumber {
  id: string;
  number: string;
  label?: string | null;
  agent?: { id: string; name: string } | null;
}

async function call<T>(path: string, apiKey: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Cartesia-Version": API_VERSION,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    // Onboarding is interactive: the owner is watching a spinner. Better to fail fast and let them
    // retry than to hold the request open on someone else's outage.
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    // Structured JSON errors from 2026-03-01 onward; fall back to the body for anything older or
    // for an error emitted before content negotiation (a gateway 502, say).
    const body = await res.text();
    let detail = body;
    try {
      const parsed = JSON.parse(body) as { title?: string; message?: string };
      if (parsed.title || parsed.message) detail = [parsed.title, parsed.message].filter(Boolean).join(": ");
    } catch {
      /* not JSON — the raw body is the best detail available */
    }
    throw new Error(`Cartesia ${init?.method ?? "GET"} ${path} failed (${res.status}): ${detail}`);
  }

  return (await res.json()) as T;
}

export interface AssignResult {
  /** False when the number was already pointed at this agent — nothing was changed. */
  changed: boolean;
  phoneNumberId: string;
}

/**
 * Points a number at the shared voice agent.
 *
 * Matches on the number rather than an id because that is what the owner has in front of them; the
 * id only exists inside Cartesia. Returns changed:false when it was already assigned, so a repeated
 * save is a no-op rather than a redundant write.
 *
 * Throws when the number isn't in the Cartesia account at all — that means it was never imported or
 * provisioned, which is a real setup gap and not something to paper over.
 */
export async function assignNumberToAgent(phoneNumber: string): Promise<AssignResult> {
  const { apiKey, agentId } = creds();
  const wanted = digits(phoneNumber);

  const list = await call<{ data?: CartesiaPhoneNumber[] }>("/agents/phone-numbers", apiKey);
  const match = (list.data ?? []).find((n) => digits(n.number) === wanted);
  if (!match) {
    throw new Error(
      `${phoneNumber} is not in the Cartesia account. Import or provision it there first, then save again.`
    );
  }

  if (match.agent?.id === agentId) return { changed: false, phoneNumberId: match.id };

  await call<CartesiaPhoneNumber>(`/agents/phone-numbers/${match.id}`, apiKey, {
    method: "PATCH",
    body: JSON.stringify({ agent_id: agentId }),
  });

  return { changed: true, phoneNumberId: match.id };
}
