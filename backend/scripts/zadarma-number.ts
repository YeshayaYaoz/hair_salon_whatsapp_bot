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
    if (has("raw")) { console.log(JSON.stringify(body, null, 2).slice(0, 4000)); return; }
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
        if (has("raw")) { console.log(`--- direction ${id} raw:`); console.log(JSON.stringify(body).slice(0, 1500)); }
        // The shape is not documented and has been observed to differ between endpoints; take
        // whichever array is present rather than assuming `info`, which is what returned an empty
        // list against a dashboard that was visibly full of numbers.
        rows =
          (body.info as Array<Record<string, unknown>>) ??
          (body.numbers as Array<Record<string, unknown>>) ??
          (body.data as Array<Record<string, unknown>>) ??
          [];
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

  const forward = arg("forward");
  if (forward) {
    // Both halves, because either alone is a number that does not ring and looks configured.
    //
    // Zadarma has to be told where to send the call, and Cartesia has to have the number imported
    // against the trunk and attached to an agent. Doing only the carrier side — which is what the
    // first run of this did — sends the call to Cartesia's SIP, where it matches no imported number
    // and is dropped *before a call record exists*: nothing in the Cartesia dashboard, nothing in
    // our logs, and a Zadarma listing that reads as correctly forwarded.
    //
    // These are the same two functions the dashboard's voice-number save calls, in the same order.
    const { pointNumberAtCartesia } = await import("../src/lib/zadarmaAdmin.js");
    const { assignNumberToAgent } = await import("../src/lib/cartesiaAdmin.js");

    const { sipId } = await pointNumberAtCartesia(forward);
    console.log(`✔ Zadarma: ${forward} forwards to ${sipId}`);

    const result = await assignNumberToAgent(forward, { label: arg("label") ?? "Tori" });
    console.log(
      result.changed
        ? `✔ Cartesia: ${result.imported ? "imported and assigned" : "assigned"} ${forward} to the agent`
        : `✔ Cartesia: ${forward} was already assigned to the agent`
    );
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

    // Zadarma has been observed to allocate from the pool and ignore the requested number: asking
    // for 972555077983 returned 972559661420. Said plainly rather than buried in the JSON, because
    // the number is what everything downstream is configured against — Meta's WABA, the carrier
    // forwarding, whatever the business prints on a card — and quietly getting a different one is
    // how the wrong number ends up in three places.
    const got = String((body as { number?: unknown }).number ?? "");
    if (got && got.replace(/\D/g, "") !== wanted.replace(/\D/g, "")) {
      console.log(`\n⚠ Zadarma allocated ${got}, NOT the requested ${wanted}.`);
      console.log("  Use the allocated number everywhere from here on.");
    }
    if (String((body as { is_activated?: unknown }).is_activated ?? "") === "false") {
      console.log("⚠ Reserved but not activated yet — it cannot receive anything until it is.");
      console.log("  Israeli numbers carry an address requirement; check the Zadarma account for");
      console.log("  a pending documents or address step.");
    }
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
