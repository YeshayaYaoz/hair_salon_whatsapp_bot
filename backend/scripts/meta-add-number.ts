/**
 * Adds a phone number to Tori's own WABA, and drives it as far towards usable as an API can.
 *
 * Usage (from backend/, against the environment holding the credentials):
 *   railway run npx tsx scripts/meta-add-number.ts --number +972559450126 --name "תורי-אונליין"
 *   railway run npx tsx scripts/meta-add-number.ts --number +972559450126 --request-code
 *   railway run npx tsx scripts/meta-add-number.ts --number +972559450126 --verify 123456
 *   railway run npx tsx scripts/meta-add-number.ts --number +972559450126 --register
 *
 * Separating Tori's own number from a customer's is not tidiness. Outreach is cold marketing to
 * strangers and collects blocks and spam reports; a salon's number serves paying customers and has
 * to keep its quality rating. On one number the first bad outreach run degrades delivery for every
 * customer of every salon behind it, and nothing in either dashboard connects the drop to its cause.
 *
 * What this cannot do, by Meta's design: the verification code arrives by SMS or voice call at the
 * number itself. No API key substitutes for holding the line. `--request-code` sends it; a person
 * reads it and passes it to `--verify`.
 *
 * A caution specific to this deployment: a number already forwarding to Cartesia will have a voice
 * verification call answered by the voice agent, which then reads the code to nobody. Use SMS, or
 * lift the forwarding first (see docs/voice-telephony-setup.md).
 */

const GRAPH = "https://graph.facebook.com/v23.0";

const token = (process.env.META_SYSTEM_USER_TOKEN ?? process.env.TORI_OUTREACH_ACCESS_TOKEN)?.trim();
const wabaId = (process.env.TORI_WABA_ID ?? process.env.WHATSAPP_WABA_ID)?.trim();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

if (!token || !wabaId) {
  console.error("META_SYSTEM_USER_TOKEN and TORI_WABA_ID must both be set in this environment.");
  process.exit(1);
}

const number = arg("number");
if (!number) {
  console.error("--number is required, in international format, e.g. +972559450126");
  process.exit(1);
}
// Meta wants the country code and the subscriber number as separate fields, not one string.
const digits = number.replace(/\D/g, "");
const cc = digits.startsWith("972") ? "972" : digits.slice(0, 3);
const local = digits.slice(cc.length);

async function call(path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const error = json.error as { message?: string; error_user_msg?: string } | undefined;
  if (!res.ok || error) throw new Error(error?.error_user_msg ?? error?.message ?? `HTTP ${res.status}`);
  return json;
}

/** The number's id on this WABA, or null if it is not on it yet. */
async function findPhoneId(): Promise<string | null> {
  const body = await call(`/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,status,code_verification_status`);
  const rows = (body.data as Array<Record<string, unknown>>) ?? [];
  const match = rows.find((r) => String(r.display_phone_number ?? "").replace(/\D/g, "") === digits);
  if (match) {
    console.log(`On the WABA: ${match.display_phone_number} — name "${match.verified_name}", status ${match.status}, verification ${match.code_verification_status}`);
  }
  return match ? String(match.id) : null;
}

async function main() {
  const existingId = await findPhoneId();

  if (has("request-code")) {
    if (!existingId) throw new Error("Number is not on this WABA yet — add it first.");
    // SMS rather than VOICE: a number forwarding to Cartesia answers a voice call with the agent.
    await call(`/${existingId}/request_code`, { code_method: "SMS", language: "he" });
    console.log("✔ Verification code requested by SMS. Read it on the phone, then re-run with --verify <code>.");
    return;
  }

  if (has("verify")) {
    if (!existingId) throw new Error("Number is not on this WABA yet — add it first.");
    const code = arg("verify");
    if (!code) throw new Error("--verify needs the six-digit code");
    await call(`/${existingId}/verify_code`, { code });
    console.log("✔ Verified. Run with --register to finish activation on Cloud API.");
    return;
  }

  if (has("register")) {
    if (!existingId) throw new Error("Number is not on this WABA yet — add it first.");
    // Two-step verification PIN. Meta rejects a different PIN once one has been set, so this is
    // printed: it has to be reused on every future re-registration of this number.
    const pin = arg("pin") ?? String(Math.floor(100000 + Math.random() * 900000));
    await call(`/${existingId}/register`, { messaging_product: "whatsapp", pin });
    console.log(`✔ Registered on Cloud API. PIN: ${pin} — store it; Meta will reject a different one later.`);
    return;
  }

  // Default action: add the number.
  if (existingId) {
    console.log("Nothing to do — the number is already on this WABA. Use --request-code, --verify or --register.");
    return;
  }
  const name = arg("name");
  if (!name) throw new Error('--name is required when adding, e.g. --name "תורי-אונליין"');

  const body = await call(`/${wabaId}/phone_numbers`, {
    cc,
    phone_number: local,
    verified_name: name,
  });
  console.log(`✔ Added ${number} to the WABA as "${name}" (id ${String(body.id)}).`);
  console.log("  Meta reviews the display name separately from verifying the line.");
  console.log("  Next: --request-code, then --verify <code>, then --register.");
}

main().catch((err) => {
  console.error("✖", (err as Error).message);
  process.exit(1);
});
