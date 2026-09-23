/**
 * Which senders this account may use towards an Israeli mobile, and what one SMS there costs.
 *
 * Usage (against the environment holding the keys):
 *   railway run npx tsx scripts/zadarma-sms-probe.ts                          # balance only, sends nothing
 *   railway run npx tsx scripts/zadarma-sms-probe.ts --phone 972501234567     # + allowed senders for that number, free
 *   railway run npx tsx scripts/zadarma-sms-probe.ts --phone 972501234567 --send   # + ONE real SMS, reports its cost
 *
 * Zadarma's list price for Israel is $0.22 per SMS (zadarma.com/en/tariffs/sms/israel/), but the
 * API is the only source that says (a) whether the business's virtual number may be the sender
 * or the message goes out as "Teamsale", and (b) what a Hebrew reminder is actually billed —
 * Hebrew packs 70 characters per SMS, so a real reminder is two. Both come from the two SMS
 * endpoints, and the sender list is per destination number (`phones`), which is why the free
 * mode still wants a number.
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

const phoneIdx = process.argv.indexOf("--phone");
const phone = phoneIdx >= 0 ? (process.argv[phoneIdx + 1] ?? "").replace(/\D/g, "") : null;
const doSend = process.argv.includes("--send");

async function main() {
  const bal = (await call("GET", "/v1/info/balance/")) as { balance?: unknown; currency?: unknown };
  console.log(`Balance: ${bal.balance} ${bal.currency}\n`);

  if (!phone) {
    console.log("No --phone given: nothing else to ask. Re-run with --phone <972…> to list the senders Zadarma allows towards it (free).");
    return;
  }
  if (!phone.startsWith("972")) {
    console.error(`Refusing: ${phone} is not an Israeli number, and the point of this probe is the Israel rate.`);
    process.exit(1);
  }

  // The sender list is per destination: Israeli carriers decide what they accept. A numeric entry
  // means the virtual number itself may be the sender; otherwise every SMS goes out as "Teamsale"
  // until a text SenderID is registered (from $20, needs a company certificate).
  let senders: string[] = [];
  try {
    const r = (await call("GET", "/v1/sms/senderid/", { phones: phone })) as { senders?: unknown };
    senders = Array.isArray(r.senders) ? r.senders.map(String) : [];
    console.log(`Allowed senders towards this number: ${senders.length ? senders.join(", ") : "(none listed)"}`);
    const numeric = senders.filter((s) => /^\d+$/.test(s));
    console.log(numeric.length
      ? `  → a virtual number may be the sender: ${numeric.join(", ")}`
      : "  → no number may be the sender; messages would arrive from a text name (default \"Teamsale\").");
  } catch (err) {
    console.log(`Sender list unavailable: ${err instanceof Error ? err.message : err}`);
  }
  console.log("");

  if (!doSend) {
    console.log("No --send: nothing sent. Add --send to send ONE real SMS and see what it is billed.");
    return;
  }

  // Deliberately Hebrew and deliberately over 70 characters: that is what a real reminder looks
  // like, and Hebrew is billed at 70 characters per SMS rather than 160. A short Latin test would
  // report a price no reminder ever pays. No link in it — Zadarma's SMS rules forbid links.
  const message = "בדיקה מתורי: תזכורת לתור מחר ב-10:00 אצל מספרת הדוגמה. לביטול כתבו 'בטל תור'.";
  const sender = senders.find((s) => /^\d+$/.test(s));
  console.log(`Sending ${message.length} chars of Hebrew${sender ? ` as ${sender}` : " with the default sender"}…`);
  const r = (await call("POST", "/v1/sms/send/", { number: phone, message, ...(sender ? { sender } : {}) })) as {
    messages?: unknown; cost?: unknown; currency?: unknown;
    sms_detalization?: Array<{ senderid?: unknown; number?: unknown; cost?: unknown }>;
    denied_numbers?: Array<{ number?: unknown; message?: unknown }>;
  };
  console.log(`\nSMS billed:  ${r.messages}`);
  console.log(`Total cost:  ${r.cost} ${r.currency}`);
  for (const d of r.sms_detalization ?? []) console.log(`  sender=${d.senderid}  cost=${d.cost}`);
  for (const d of r.denied_numbers ?? []) console.log(`  DENIED: ${d.message}`);
  const segs = Number(r.messages) || 1;
  const total = Number(r.cost);
  console.log(`\nPer SMS: $${(total / segs).toFixed(3)}  →  this ${segs}-part Hebrew reminder = $${total.toFixed(3)} ≈ ₪${(total * 3.7).toFixed(2)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
