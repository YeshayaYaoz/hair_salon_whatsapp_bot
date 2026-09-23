/**
 * What an SMS to an Israeli mobile actually costs, and which senders this account may use.
 *
 * Usage (against the environment holding the keys):
 *   railway run npx tsx scripts/zadarma-sms-probe.ts                       # senders + balance only, sends nothing
 *   railway run npx tsx scripts/zadarma-sms-probe.ts --send 972501234567   # ONE real SMS, reports its cost
 *
 * Zadarma publishes SMS prices in a script-rendered table and offers no lookup endpoint for them
 * (/v1/info/price/ is the CALL rate). The only authoritative source is what /v1/sms/send/ itself
 * returns: `cost` per number, plus `denied_numbers` with the carrier's reason. So the price for
 * Israel is learned by sending one message — which costs money, and is why --send is explicit
 * and takes a number rather than defaulting to anything.
 *
 * The senderid list is the other thing the whole SMS idea rests on: whether Israeli carriers will
 * accept a message from the virtual number, or a text sender ("Tori") has to be registered. That
 * is free to ask and asked every time.
 */
import { createHash, createHmac } from "crypto";

const BASE_URL = "https://api.zadarma.com";
const key = process.env.ZADARMA_API_KEY?.trim();
const secret = process.env.ZADARMA_API_SECRET?.trim();
if (!key || !secret) {
  console.error("ZADARMA_API_KEY / ZADARMA_API_SECRET are not set — run via `railway run`.");
  process.exit(1);
}

async function call(method: "GET" | "POST", methodPath: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(Object.keys(params).sort().map((k) => [k, params[k]] as [string, string])).toString();
  const md5 = createHash("md5").update(query).digest("hex");
  const signature = Buffer.from(createHmac("sha1", secret!).update(methodPath + query + md5).digest("hex")).toString("base64");
  const res = await fetch(`${BASE_URL}${methodPath}` + (method === "GET" && query ? `?${query}` : ""), {
    method,
    headers: { Authorization: `${key}:${signature}`, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    ...(method === "POST" ? { body: query } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || body.status === "error") throw new Error(`${methodPath}: ${(body.message as string) ?? `HTTP ${res.status}`}`);
  return body;
}

const sendIdx = process.argv.indexOf("--send");
const sendTo = sendIdx >= 0 ? (process.argv[sendIdx + 1] ?? "").replace(/\D/g, "") : null;

async function main() {
  const bal = (await call("GET", "/v1/info/balance/")) as { balance?: unknown; currency?: unknown };
  console.log(`Balance: ${bal.balance} ${bal.currency}\n`);

  const senders = await call("GET", "/v1/sms/senderid/");
  console.log("Allowed SMS senders (raw):");
  console.log(JSON.stringify(senders, null, 2));
  console.log("");

  if (!sendTo) {
    console.log("No --send given: nothing sent. Re-run with --send <972…> to learn the real per-message cost for Israel.");
    return;
  }
  if (!sendTo.startsWith("972")) {
    console.error(`Refusing: ${sendTo} is not an Israeli number, and the point of this probe is the Israel rate.`);
    process.exit(1);
  }

  // Deliberately Hebrew and deliberately over 70 characters: that is what a real reminder looks
  // like, and Hebrew is billed at 70 characters per segment rather than 160. A short Latin test
  // would report a price no reminder ever pays.
  const message = "בדיקה מתורי: תזכורת לתור מחר ב-10:00 אצל מספרת הדוגמה. לביטול כתבו 'בטל תור'.";
  console.log(`Sending ${message.length} chars of Hebrew to ${sendTo}…`);
  const r = (await call("POST", "/v1/sms/send/", { number: sendTo, message })) as {
    messages?: unknown; cost?: unknown; currency?: unknown;
    sms_detalization?: Array<{ senderid?: unknown; number?: unknown; cost?: unknown }>;
    denied_numbers?: Array<{ number?: unknown; message?: unknown }>;
  };
  console.log(`\nSegments billed: ${r.messages}`);
  console.log(`Total cost:      ${r.cost} ${r.currency}`);
  for (const d of r.sms_detalization ?? []) console.log(`  sender=${d.senderid}  to=${d.number}  cost=${d.cost}`);
  for (const d of r.denied_numbers ?? []) console.log(`  DENIED ${d.number}: ${d.message}`);
  const segs = Number(r.messages) || 1;
  const perSeg = Number(r.cost) / segs;
  console.log(`\nPer segment: $${perSeg.toFixed(4)}  →  a ${segs}-segment Hebrew reminder ≈ $${Number(r.cost).toFixed(3)} ≈ ₪${(Number(r.cost) * 3.7).toFixed(2)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
