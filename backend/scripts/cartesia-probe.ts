/**
 * Read-only inventory of the Cartesia account behind CARTESIA_API_KEY.
 *
 * Usage (from backend/, against the environment that holds the key):
 *   railway run npx tsx scripts/cartesia-probe.ts
 *
 * Why this exists: onboarding a salon's voice line depends on facts about the Cartesia account that
 * are not in our database — how many numbers are attached, which agent they point at, and which
 * telephony provider carries them. `assignNumberToAgent` fails with "not in the Cartesia account"
 * for a number that was never imported, and nothing on our side can tell the difference between
 * that and a typo. This prints the account state that error is really about.
 *
 * Everything here is a GET. Nothing is created, assigned, or deleted.
 *
 * On the API surface this checks: the docs at docs.cartesia.ai confirm `GET /agents/phone-numbers`
 * and `PATCH /agents/phone-numbers/{id}` (the two calls cartesiaAdmin.ts makes) and the pinned
 * Cartesia-Version of 2026-03-01. The published TypeScript SDK is older — it sends 2025-11-04 and
 * documents neither endpoint — so the SDK is not a reliable guide to what the API supports.
 */

const BASE_URL = "https://api.cartesia.ai";
const API_VERSION = "2026-03-01";

const apiKey = process.env.CARTESIA_API_KEY?.trim();
const agentId = process.env.CARTESIA_AGENT_ID?.trim();

if (!apiKey) {
  console.error("CARTESIA_API_KEY is not set in this environment — nothing to probe.");
  process.exit(1);
}

async function get(path: string): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Cartesia-Version": API_VERSION,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
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

function brief(value: unknown, max = 300): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "(empty)";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function heading(title: string): void {
  console.log(`\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}`);
}

async function main(): Promise<void> {
  console.log(`Probing ${BASE_URL} (Cartesia-Version ${API_VERSION}) with a key of length ${apiKey!.length}.`);
  console.log(`CARTESIA_AGENT_ID: ${agentId || "NOT SET — the assignment target is unknown"}`);

  // Which agents exist, and what voice each is pinned to. tts_voice is the agent's DEFAULT; agent
  // code can override it per call with AgentUpdateCall(voice_id=...), so this is the fallback a
  // salon hears if nothing sets a voice for it, not necessarily what every caller gets.
  heading("Agents — and the default voice each falls back to");
  const agents = await get("/agents");
  console.log(`  GET /agents → HTTP ${agents.status}`);
  const agentList = (agents.body as { data?: Array<Record<string, unknown>> } | null)?.data;
  if (Array.isArray(agentList)) {
    console.log(`  ${agentList.length} agent(s).`);
    for (const a of agentList) {
      const mine = a.id === agentId ? "  ← CARTESIA_AGENT_ID" : "";
      console.log(`    - ${a.id} "${a.name}"  tts_voice=${a.tts_voice ?? "(none)"}  tts_language=${a.tts_language ?? "(none)"}${mine}`);
    }
  } else {
    console.log(`  ${brief(agents.body)}`);
  }

  // The list assignNumberToAgent matches against. A salon whose number is missing here is the exact
  // case that throws during onboarding — it means the number was never imported or provisioned.
  heading("Phone numbers — what onboarding can actually match against");
  const numbers = await get("/agents/phone-numbers");
  console.log(`  GET /agents/phone-numbers → HTTP ${numbers.status}`);
  const numberList = (numbers.body as { data?: Array<Record<string, unknown>> } | null)?.data;
  if (Array.isArray(numberList)) {
    console.log(`  ${numberList.length} number(s) in the account.`);
    const attachedToOurAgent = numberList.filter(
      (n) => (n.agent as { id?: string } | null)?.id === agentId || n.agent_id === agentId
    ).length;
    for (const n of numberList) {
      const provider = (n.provider as { type?: string } | null)?.type ?? "(unknown provider)";
      const agent = (n.agent as { id?: string } | null)?.id ?? n.agent_id ?? "UNASSIGNED";
      console.log(`    - ${n.number}  id=${n.id}  provider=${provider}  agent=${agent}`);
    }
    if (agentId) {
      console.log(`  ${attachedToOurAgent} of them route to CARTESIA_AGENT_ID.`);
      console.log(
        "  (An agent may hold many numbers — one per salon is the supported shape, not a limit being stretched.)"
      );
    }
    const unassigned = numberList.filter((n) => !((n.agent as { id?: string } | null)?.id ?? n.agent_id));
    if (unassigned.length) {
      console.log(`  ⚠ ${unassigned.length} number(s) are assigned to NO agent — those accept calls and hang up.`);
    }
  } else {
    console.log(`  ${brief(numbers.body)}`);
  }

  // Which carriers are linked. Cartesia-provisioned numbers are US-only; Israeli numbers have to
  // arrive over a Twilio import or a SIP trunk, so this says which path this account is set up for.
  heading("Telephony providers — how numbers can reach this account");
  const providers = await get("/agents/phone-numbers/providers");
  console.log(`  GET /agents/phone-numbers/providers → HTTP ${providers.status}`);
  const providerList = (providers.body as { data?: Array<Record<string, unknown>> } | null)?.data;
  if (Array.isArray(providerList)) {
    if (!providerList.length) {
      console.log("  None linked — only Cartesia-provisioned US numbers are available on this account.");
    }
    for (const p of providerList) {
      console.log(`    - ${p.id} type=${p.type} label=${p.label ?? "(none)"}`);
    }
  } else {
    console.log(`  ${brief(providers.body)}`);
  }

  heading("Done");
}

main().catch((err) => {
  console.error("Probe failed:", err);
  process.exit(1);
});
