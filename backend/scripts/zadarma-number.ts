/**
 * Lists and (deliberately, separately) orders Zadarma virtual numbers.
 *
 * Usage (from backend/, against the environment holding the keys):
 *   railway run npx tsx scripts/zadarma-number.ts --list IL
 *   railway run npx tsx scripts/zadarma-number.ts --available <DIRECTION_ID>
 *   railway run npx tsx scripts/zadarma-number.ts --order <DIRECTION_ID> --number <NUMBER> --confirm
 *
 * `--order` refuses to run without `--confirm` and without naming the exact number. Ordering starts
 * a recurring monthly charge, and the difference between "configure a line that exists" and "commit
 * to paying for a new one every month" is the difference between a task and a decision. Everything
 * else here is read-only.
 *
 * For a WhatsApp number specifically, the field to read in the listing is SMS support: Meta's
 * verification code arrives by SMS or by a voice call to the number. A number that cannot receive
 * SMS is still usable here — the voice call is answered by the agent and the code lands in the call
 * transcript — but SMS is the path with fewer moving parts.
 */

import { createHash, createHmac } from "crypto";

const BASE_URL = "https://api.zadarma.com";
const key = process.env.ZADARMA_API_KEY?.trim();
const secret = process.env.ZADARMA_API_SECRET?.trim();

if (!key || !secret) {
  console.error("ZADARMA_API_KEY / ZADARMA_API_SECRET are not set in this environment.");
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function request(method: "GET" | "POST", path: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(
    Object.keys(params)
      .sort()
      .map((k) => [k, params[k]] as [string, string])
  ).toString();
  const md5 = createHash("md5").update(query).digest("hex");
  const signature = Buffer.from(
    createHmac("sha1", secret!).update(path + query + md5).digest("hex")
  ).toString("base64");

  const res = await fetch(`${BASE_URL}${path}${method === "GET" && query ? `?${query}` : ""}`, {
    method,
    headers: {
      Authorization: `${key}:${signature}`,
      ...(method === "GET" ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
    },
    ...(method === "GET" ? {} : { body: query }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Zadarma answers 200 with {"status":"error"}; the HTTP status alone reports every rejection as
  // a success.
  if (!res.ok || body.status === "error") {
    throw new Error(`${path}: ${(body.message as string) ?? `HTTP ${res.status}`}`);
  }
  return body;
}

async function main() {
  const country = arg("list");
  if (country) {
    const body = await request("GET", "/v1/direct_numbers/country/", { country });
    const rows = (body.info as Array<Record<string, unknown>>) ?? [];
    if (rows.length === 0) {
      console.log(`No destinations available in ${country}.`);
      return;
    }
    console.log(`Destinations in ${country}:\n`);
    for (const r of rows) {
      // Field names vary across Zadarma's responses; print the ones present rather than assuming.
      const id = r.direction_id ?? r.id;
      const monthly = r.monthly_fee ?? r.month_fee ?? r.price;
      const setup = r.connection_cost ?? r.start_cost;
      const sms = r.sms ?? r.sms_supported ?? r.is_sms;
      console.log(`  id=${String(id)}  ${String(r.city ?? r.name ?? "")}`);
      console.log(`      monthly=${String(monthly ?? "?")}  setup=${String(setup ?? "?")}  sms=${String(sms ?? "?")}`);
      // Documents are the one part of provisioning with a person in it, and they are per account
      // rather than per number — worth surfacing before an order rather than after it fails.
      if (r.documents ?? r.need_documents) console.log(`      documents required: ${String(r.documents ?? r.need_documents)}`);
    }
    console.log("\nNext: --available <id> to see actual numbers.");
    return;
  }

  const directionId = arg("available");
  if (directionId) {
    // Comma-separated, because "which destinations actually have stock" is one question and asking
    // it one id at a time is a round trip per id.
    for (const id of directionId.split(",").map((s) => s.trim()).filter(Boolean)) {
      let rows: Array<Record<string, unknown>> = [];
      try {
        const body = await request("GET", `/v1/direct_numbers/available/${id}/`);
        rows = (body.info as Array<Record<string, unknown>>) ?? [];
      } catch (err) {
        console.log(`  direction ${id}: ${(err as Error).message}`);
        continue;
      }
      console.log(`direction ${id}: ${rows.length} available`);
      for (const r of rows.slice(0, 10)) console.log(`    ${String(r.number ?? r)}`);
      if (rows.length > 10) console.log(`    … and ${rows.length - 10} more`);
    }
    return;
  }

  const orderDirection = arg("order");
  if (orderDirection) {
    const wanted = arg("number");
    if (!wanted) throw new Error("--order also needs --number: ordering picks one specific line, not whichever comes back first");
    if (!has("confirm")) {
      console.log(`Would order ${wanted} on direction ${orderDirection}.`);
      console.log("This starts a recurring monthly charge. Re-run with --confirm to actually place it.");
      return;
    }
    const body = await request("POST", "/v1/direct_numbers/order/", {
      direction_id: orderDirection,
      number: wanted,
    });
    console.log("✔ Ordered.", JSON.stringify(body));
    console.log("  Point it at Cartesia by saving it as a voice number in the dashboard, or leave");
    console.log("  it unforwarded if this one is for WhatsApp only.");
    return;
  }

  console.log("Nothing to do. Use --list <ISO country>, --available <id>, or --order <id> --number <n> --confirm.");
}

main().catch((err) => {
  console.error("✖", (err as Error).message);
  process.exit(1);
});
