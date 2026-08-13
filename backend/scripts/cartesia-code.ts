/**
 * Reads a verification code out of a recent Cartesia call.
 *
 * Usage (from backend/, against the environment holding CARTESIA_API_KEY):
 *   railway run npx tsx scripts/cartesia-code.ts --to +972559661420
 *   railway run npx tsx scripts/cartesia-code.ts --to +972559661420 --discover
 *
 * Meta will send a WhatsApp verification code either by SMS or by calling the number and reading it
 * aloud. An inbound SMS to a Zadarma number is billed; an inbound call is not — and the call is
 * answered by the voice agent anyway, which means the code is spoken into a transcript we can
 * fetch. So the cheap path and the automatable path are the same path.
 *
 * Cartesia's call API is not something to guess at, so `--discover` tries the plausible endpoints
 * and prints which answer. Once one is known to work the normal run uses it directly.
 *
 * The code is printed. It is single-use and expires in minutes, and it lands in a CI log — which is
 * why the workflow that runs this masks it. Do not widen that.
 */

const BASE_URL = "https://api.cartesia.ai";
const API_VERSION = "2026-03-01";
const apiKey = process.env.CARTESIA_API_KEY?.trim();
const agentId = process.env.CARTESIA_AGENT_ID?.trim();

if (!apiKey) {
  console.error("CARTESIA_API_KEY is not set in this environment.");
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function get(path: string): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Cartesia-Version": API_VERSION,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) };
    } catch {
      return { status: res.status, body: text };
    }
  } catch (err) {
    return { status: 0, body: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Six consecutive digits, however they were spoken.
 *
 * Meta's robot reads the code digit by digit, so the transcript may hold "1 2 3 4 5 6", "123456",
 * or digits separated by hyphens or commas depending on how the STT segmented it. Stripping
 * non-digits from a window and taking the first run of six is more robust than matching a format.
 * The Hebrew words are here because the agent's STT is configured for Hebrew and will sometimes
 * transcribe spoken English digits into Hebrew words.
 */
const HEBREW_DIGITS: Record<string, string> = {
  אפס: "0", אחת: "1", אחד: "1", שתיים: "2", שניים: "2", שלוש: "3", שלושה: "3",
  ארבע: "4", ארבעה: "4", חמש: "5", חמישה: "5", שש: "6", שישה: "6",
  שבע: "7", שבעה: "7", שמונה: "8", תשע: "9", תשעה: "9",
};

export function extractCode(text: string): string | null {
  const normalized = text
    .split(/\s+/)
    .map((w) => HEBREW_DIGITS[w.replace(/[^֐-׿]/g, "")] ?? w)
    .join(" ");
  const digitsOnly = normalized.replace(/\D/g, "");
  const m = digitsOnly.match(/\d{6}/);
  return m ? m[0] : null;
}

/** Every string in an arbitrarily-shaped payload, so a transcript is found wherever it is nested. */
function allText(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) allText(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) allText(v, out);
  return out;
}

// Settled by --discover against the live account: /agents/calls is the endpoint, and it requires
// agent_id as a query parameter rather than a path segment. /calls, /agents/call-history and
// /agents/{id}/calls all 404.
const CALLS_PATH = "/agents/calls";

function callsUrl(limit: number): string {
  if (!agentId) throw new Error("CARTESIA_AGENT_ID is required — /agents/calls takes it as a query parameter");
  return `${CALLS_PATH}?agent_id=${encodeURIComponent(agentId)}&limit=${limit}`;
}

async function main() {
  if (has("discover")) {
    const r = await get(callsUrl(5));
    const shape = typeof r.body === "string" ? r.body.slice(0, 400) : JSON.stringify(r.body, null, 2).slice(0, 2500);
    console.log(`GET ${callsUrl(5)} → ${r.status}\n${shape}`);
    return;
  }

  const to = arg("to");
  if (!to) throw new Error("--to is required: the number Meta called");
  const wanted = to.replace(/\D/g, "");

  const list = await get(callsUrl(20));
  if (list.status !== 200) {
    console.log(`GET ${CALLS_PATH} → ${list.status}: ${JSON.stringify(list.body).slice(0, 300)}`);
    return;
  }

  const body = list.body as Record<string, unknown>;
  const calls = ((body?.data as unknown[]) ?? (body?.calls as unknown[]) ?? []) as Array<Record<string, unknown>>;
  if (calls.length === 0) {
    console.log("No calls on this agent yet.");
    return;
  }

  // Match on the dialled number rather than "these digits appear somewhere": every call payload is
  // full of digits, and another salon's call would match by accident.
  const mine = calls.filter((c) => {
    const tp = (c.telephony_params ?? {}) as Record<string, unknown>;
    return String(tp.to ?? "").replace(/\D/g, "") === wanted;
  });
  if (mine.length === 0) {
    console.log(`${calls.length} recent call(s), none to ${to}.`);
    console.log("Meta calls only after --request-code, and the record appears when the call ends.");
    return;
  }

  // The list carries a summary, not the words. A summary of a robot reading six digits may or may
  // not contain them, so the transcript is fetched per call — and the sub-resource is undocumented,
  // so the plausible ones are tried and the first that answers is used.
  const SUBPATHS = ["", "/transcript", "/messages", "/events"];
  for (const call of mine) {
    const id = String(call.id ?? "");
    // Newest first, and the summary is free to check before spending requests on sub-resources.
    for (const sub of SUBPATHS) {
      const detail = await get(`${CALLS_PATH}/${encodeURIComponent(id)}${sub}`);
      if (detail.status !== 200) continue;
      const code = extractCode(allText(detail.body).join(" "));
      if (code) {
        console.log(`Found a six-digit code in ${CALLS_PATH}/${id}${sub}: ${code}`);
        return;
      }
      console.log(`  ${CALLS_PATH}/${id}${sub} → 200, no six-digit run in it`);
    }
  }

  console.log(`\n${mine.length} call(s) to ${to}, none carrying a readable code.`);
  console.log("If Meta has just called, wait for the call to end — the transcript is written then.");
main().catch((err) => {
  console.error("✖", (err as Error).message);
  process.exit(1);
});
