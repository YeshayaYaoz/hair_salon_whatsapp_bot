/**
 * Registers a SIP trunk with Cartesia, so a carrier's numbers can be imported against it.
 *
 * This is the one-time operator step that `CARTESIA_SIP_PROVIDER_ID` refers to. Everything after it
 * is already automated: `assignNumberToAgent` imports each salon's number against this provider and
 * points it at the shared voice agent.
 *
 * Why a trunk at all: Cartesia provisions US numbers only. An Israeli number has to arrive over a
 * carrier we bring ourselves, and a SIP trunk is the path that keeps it on that carrier's rates
 * rather than a CPaaS markup.
 *
 * Usage (from backend/, against the environment holding CARTESIA_API_KEY):
 *   npx tsx scripts/cartesia-trunk-setup.ts --label "Zadarma" --numbers +972XXXXXXXXX
 *   npx tsx scripts/cartesia-trunk-setup.ts --label "Zadarma" --addresses 185.45.152.42,185.45.152.43
 *
 * Access control is required, not optional — Cartesia rejects an inbound trunk with credentials,
 * allowed_addresses and allowed_numbers all empty, and rightly so: an open trunk accepts calls from
 * anyone who can find it. Prefer --numbers for a trial: it needs nothing from the carrier, whereas
 * an IP allowlist means chasing their signalling ranges (and on the LiveKit backend Cartesia runs
 * on, allowed_addresses has to be enabled per project by support).
 *
 * Prints the provider id. Nothing is written to the database and nothing else is touched.
 */

const BASE_URL = "https://api.cartesia.ai";
const API_VERSION = "2026-03-01";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const apiKey = process.env.CARTESIA_API_KEY?.trim();
if (!apiKey) {
  console.error("CARTESIA_API_KEY is not set in this environment.");
  process.exit(1);
}

const label = arg("label") ?? "BYO SIP trunk";
const numbers = (arg("numbers") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const addresses = (arg("addresses") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const username = arg("username");
const password = arg("password");

if (!numbers.length && !addresses.length && !(username && password)) {
  console.error(
    "Refusing to create a trunk with no access control. Pass one of:\n" +
      "  --numbers +972XXXXXXXXX[,+972YYYYYYYYY]   the numbers this trunk may present (simplest)\n" +
      "  --addresses 1.2.3.4,5.6.7.8               your carrier's SIP signalling IPs\n" +
      "  --username U --password P                 digest auth, if your carrier can send it"
  );
  process.exit(1);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Cartesia-Version": API_VERSION,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

interface Provider {
  id: string;
  type: string;
  label?: string | null;
}

async function main(): Promise<void> {
  // Listed first because each carrier account should be linked once. Creating a second trunk for the
  // same carrier splits numbers across two providers, and the one in CARTESIA_SIP_PROVIDER_ID is
  // then only half the story.
  const existing = await call<{ data?: Provider[] }>("/agents/phone-numbers/providers");
  const providers = existing.data ?? [];
  if (providers.length) {
    console.log(`${providers.length} provider(s) already linked:`);
    for (const p of providers) console.log(`  - ${p.id}  type=${p.type}  label=${p.label ?? "(none)"}`);
    const clash = providers.find((p) => p.label === label);
    if (clash) {
      console.log(`\nA provider labelled "${label}" already exists (${clash.id}). Nothing created.`);
      console.log(`Set CARTESIA_SIP_PROVIDER_ID=${clash.id} if that is the one you want.`);
      return;
    }
    console.log("");
  }

  const inbound: Record<string, unknown> = {
    // "allowed" rather than "required": SRTP has to be enabled on the carrier side too, and
    // requiring it before that is done rejects every call with nothing to show why.
    media_encryption: "allowed",
  };
  if (numbers.length) inbound.allowed_numbers = numbers;
  if (addresses.length) inbound.allowed_addresses = addresses;
  if (username && password) inbound.credentials = { username, password };

  const created = await call<Provider>("/agents/phone-numbers/providers", {
    method: "POST",
    // Inbound only. Outbound (the agent placing calls) needs the carrier's own SIP endpoint and
    // credentials, and nothing in the product dials out yet — configuring it now would be guessing
    // at settings no code uses.
    body: JSON.stringify({ type: "sip_trunk", label, inbound }),
  });

  console.log(`Created ${created.type} provider "${created.label}"`);
  console.log(`\n  CARTESIA_SIP_PROVIDER_ID=${created.id}\n`);
  console.log("Next: point the number at Cartesia on the carrier side, then save it in the");
  console.log("dashboard's Bot page — the app imports and assigns it from there.");
}

main().catch((err) => {
  console.error("Trunk setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
