/**
 * Read-only probe of the Cartesia account behind CARTESIA_API_KEY.
 *
 * Purpose: `src/lib/cartesiaAdmin.ts` was written against an API nobody has ever called. Its two
 * endpoints do not appear in the official SDK (@cartesia/cartesia-js@3.5.1), and the version it
 * pins — 2026-03-01 — is newer than the 2025-11-04 that SDK sends. Whether voice onboarding works
 * at all is therefore an open question that cannot be settled by reading our own code.
 *
 * It also settles the architectural question underneath it. That SDK documents "you can only have
 * one phone number per agent", and carries tts_voice on the AGENT rather than on a call. If both
 * hold, then one number per salon and one voice per salon both require one AGENT per salon — and
 * our design assumes a single shared agent for the whole product.
 *
 * Usage (from backend/, against the environment that actually holds the key):
 *   railway run npx tsx scripts/cartesia-probe.ts
 *
 * Safe to run against production. Every request is a GET except two PATCHes aimed at deliberately
 * non-existent ids, which exist only to tell "this route is missing" apart from "this row is
 * missing" — neither can match a real phone number, so neither can change anything. The key is
 * never printed.
 */

const BASE_URL = "https://api.cartesia.ai";

/** What cartesiaAdmin.ts pins today, and what the official SDK sends. Both are tried. */
const OUR_VERSION = "2026-03-01";
const SDK_VERSION = "2025-11-04";

const apiKey = process.env.CARTESIA_API_KEY?.trim();
const agentId = process.env.CARTESIA_AGENT_ID?.trim();

if (!apiKey) {
  console.error("CARTESIA_API_KEY is not set in this environment — nothing to probe.");
  process.exit(1);
}

interface Probe {
  status: number;
  body: unknown;
  error?: string;
}

async function probe(
  path: string,
  { version = SDK_VERSION, method = "GET", body }: { version?: string; method?: string; body?: unknown } = {}
): Promise<Probe> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Cartesia-Version": version,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON — the raw body is the useful detail */
    }
    return { status: res.status, body: parsed };
  } catch (err) {
    return { status: 0, body: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Keeps the output readable — full agent objects are long and mostly irrelevant here. */
function brief(value: unknown, max = 400): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "(empty)";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function heading(title: string): void {
  console.log(`\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}`);
}

async function main(): Promise<void> {
  console.log(`Probing ${BASE_URL} with a key of length ${apiKey!.length}.`);
  console.log(`CARTESIA_AGENT_ID: ${agentId ? agentId : "NOT SET — agent-scoped checks will be skipped"}`);

  // 1. Does the key work at all, and which version header does this account accept? A rejected
  //    version is the cheapest explanation for every call failing, so it is checked first.
  heading("1. Version header — is the pinned 2026-03-01 real?");
  for (const version of [OUR_VERSION, SDK_VERSION]) {
    const res = await probe("/agents", { version });
    const label = version === OUR_VERSION ? "ours" : "SDK";
    console.log(`  Cartesia-Version: ${version} (${label}) → HTTP ${res.status}${res.error ? ` [${res.error}]` : ""}`);
    if (res.status >= 400) console.log(`    ${brief(res.body, 240)}`);
  }

  // 2. How many agents exist, and what voice is each pinned to? If tts_voice is per-agent, this is
  //    the whole answer to "can two salons have different voices".
  heading("2. Agents — how many, and what voice is each one pinned to?");
  const agents = await probe("/agents");
  console.log(`  GET /agents → HTTP ${agents.status}`);
  const list = (agents.body as { data?: Array<Record<string, unknown>> } | null)?.data;
  if (Array.isArray(list)) {
    console.log(`  ${list.length} agent(s) in this account.`);
    for (const a of list) {
      console.log(`    - ${a.id} "${a.name}"  tts_voice=${a.tts_voice ?? "(none)"}  tts_language=${a.tts_language ?? "(none)"}`);
    }
  } else {
    console.log(`  ${brief(agents.body)}`);
  }

  // 3. The claim that decides the architecture: one phone number per agent. If our single shared
  //    agent already holds more than one, the SDK's docstring is stale and the design survives.
  heading("3. Phone numbers on our agent — is it really one per agent?");
  if (agentId) {
    const scoped = await probe(`/agents/${agentId}/phone-numbers`);
    console.log(`  GET /agents/{agentId}/phone-numbers → HTTP ${scoped.status}   [the SDK's path]`);
    const numbers = (scoped.body as { data?: unknown[] } | null)?.data;
    if (Array.isArray(numbers)) {
      console.log(`  ${numbers.length} number(s) attached to this agent.`);
      console.log(
        numbers.length > 1
          ? "  → More than one. The SDK's 'one phone number per agent' note is stale; the shared-agent design holds."
          : "  → One or none. Consistent with one-number-per-agent, which breaks the shared-agent design at the second salon."
      );
      for (const n of numbers) console.log(`    - ${brief(n, 200)}`);
    } else {
      console.log(`  ${brief(scoped.body)}`);
    }
  } else {
    console.log("  Skipped — CARTESIA_AGENT_ID is not set.");
  }

  // 4. The two endpoints cartesiaAdmin.ts actually calls. A 404 here means voice onboarding has
  //    never worked, and would fail the first time a salon saved a number.
  heading("4. The endpoints cartesiaAdmin.ts calls today — do they exist?");
  const unscoped = await probe("/agents/phone-numbers");
  console.log(`  GET /agents/phone-numbers → HTTP ${unscoped.status}   [what assignNumberToAgent lists with]`);
  console.log(`    ${brief(unscoped.body, 240)}`);

  // A bogus id on a real route answers "no such number"; a bogus id on a missing route answers
  // "no such route". Comparing the two bodies is what distinguishes them.
  const bogusOnRealRoute = await probe("/agents/phone-numbers/probe-nonexistent-id", {
    method: "PATCH",
    body: { agent_id: agentId ?? "probe-nonexistent-agent" },
  });
  const bogusRoute = await probe("/agents/probe-not-a-route/probe-nonexistent-id", {
    method: "PATCH",
    body: {},
  });
  console.log(`  PATCH /agents/phone-numbers/{id} → HTTP ${bogusOnRealRoute.status}   [what it assigns with]`);
  console.log(`    ${brief(bogusOnRealRoute.body, 240)}`);
  console.log(`  PATCH /agents/{bogus-route}/{id} → HTTP ${bogusRoute.status}   [control: a route that certainly does not exist]`);
  console.log(`    ${brief(bogusRoute.body, 240)}`);
  console.log(
    "  → If the two bodies match, our PATCH path does not exist either and assignNumberToAgent is dead code."
  );

  // 5. Whether a voice can be overridden per call rather than per agent. The SDK has no such field,
  //    but the API may carry one the client has not caught up with.
  heading("5. Is tts_voice writable per agent? (does not write — reads the update surface)");
  if (agentId) {
    const agent = await probe(`/agents/${agentId}`);
    console.log(`  GET /agents/{agentId} → HTTP ${agent.status}`);
    const body = agent.body as Record<string, unknown> | null;
    if (body && typeof body === "object") {
      console.log(`  tts_voice=${body.tts_voice ?? "(none)"}  tts_language=${body.tts_language ?? "(none)"}`);
      console.log(`  full shape: ${brief(Object.keys(body).join(", "), 400)}`);
    } else {
      console.log(`  ${brief(agent.body)}`);
    }
  } else {
    console.log("  Skipped — CARTESIA_AGENT_ID is not set.");
  }

  heading("Done");
  console.log("Paste this output back and the voice architecture stops being guesswork.\n");
}

main().catch((err) => {
  console.error("Probe failed:", err);
  process.exit(1);
});
