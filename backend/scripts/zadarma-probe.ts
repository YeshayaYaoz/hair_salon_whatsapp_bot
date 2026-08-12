/**
 * Read-only inventory of the Zadarma account behind ZADARMA_API_KEY.
 *
 * Usage (from backend/, against the environment that holds the keys):
 *   railway run npx tsx scripts/zadarma-probe.ts
 *
 * Why this exists: saving a salon's voice number now also sets the carrier's forwarding, and that
 * call fails for two very different reasons which look identical from the dashboard — credentials
 * that do not authenticate, and a number that simply is not on this account. The first is a
 * configuration mistake to fix once; the second is ordinary, and means the salon brought a number
 * from elsewhere. This says which.
 *
 * It also prints where each number currently forwards, so "the line does not ring" can be answered
 * without logging into anyone's console: a number with no SIP destination, or one pointing
 * somewhere other than Cartesia, explains the silence on its own.
 *
 * Everything here is a GET. Nothing is ordered, changed, or released.
 */

import { createHash, createHmac } from "crypto";

const BASE_URL = "https://api.zadarma.com";

const key = process.env.ZADARMA_API_KEY?.trim();
const secret = process.env.ZADARMA_API_SECRET?.trim();

if (!key || !secret) {
  console.error("ZADARMA_API_KEY / ZADARMA_API_SECRET are not set in this environment.");
  console.error("Run against the environment that holds them, e.g. `railway run npx tsx scripts/zadarma-probe.ts`.");
  process.exit(1);
}

async function get(methodPath: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const query = new URLSearchParams(
    Object.keys(params)
      .sort()
      .map((k) => [k, params[k]] as [string, string])
  ).toString();
  const md5 = createHash("md5").update(query).digest("hex");
  const signature = Buffer.from(
    createHmac("sha1", secret!).update(methodPath + query + md5).digest("hex")
  ).toString("base64");

  const res = await fetch(`${BASE_URL}${methodPath}${query ? `?${query}` : ""}`, {
    headers: { Authorization: `${key}:${signature}` },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Zadarma answers 200 with {"status":"error"}, so the HTTP status alone reports every rejection
  // as a success.
  if (!res.ok || body.status === "error") {
    throw new Error(`${methodPath}: ${(body.message as string) ?? `HTTP ${res.status}`}`);
  }
  return body;
}

const CARTESIA_HOST = process.env.CARTESIA_SIP_HOST?.trim() || "sip.cartesia.ai";

async function main() {
  let numbers: Array<Record<string, unknown>>;
  try {
    const body = await get("/v1/direct_numbers/");
    numbers = (body.info as Array<Record<string, unknown>>) ?? [];
  } catch (err) {
    console.error(`✖ Zadarma rejected the credentials or the request: ${(err as Error).message}`);
    console.error("  A flat authentication failure here is usually the signature, not the keys —");
    console.error("  parameters must be sorted by key before hashing. See lib/zadarmaAdmin.ts.");
    process.exit(1);
  }

  console.log(`✔ Authenticated. ${numbers.length} number(s) on this account.\n`);
  if (numbers.length === 0) {
    console.log("  Nothing to forward. Numbers are bought manually, by design — ordering spends money.");
    return;
  }

  for (const n of numbers) {
    const number = String(n.number ?? "?");
    // Zadarma's field naming for the destination has varied; print whichever is present rather
    // than guessing one and reporting "not set" for a number that is in fact configured.
    const dest = [n.sip_id, n.sip, n.redirection, n.destination].find((v) => v);
    const points = dest ? String(dest) : null;
    const mark = !points ? "✖" : points.includes(CARTESIA_HOST) ? "✔" : "!";
    console.log(`  ${mark} ${number}  type=${String(n.type ?? "?")}`);
    if (!points) {
      console.log(`      no SIP destination — calls to this number reach nobody`);
    } else if (points.includes(CARTESIA_HOST)) {
      console.log(`      → ${points}`);
      if (!points.startsWith("+")) {
        console.log(`      ⚠ no leading "+" — Cartesia matches on +E.164, so calls are dropped`);
        console.log(`        before a call record exists and both sides look correctly configured`);
      }
    } else {
      console.log(`      → ${points}  (not Cartesia)`);
    }
  }

  console.log("\nSaving a voice number in the dashboard sets the ✔ state automatically.");
}

main().catch((err) => {
  console.error("Probe failed:", err);
  process.exit(1);
});
