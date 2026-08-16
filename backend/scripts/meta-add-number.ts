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
 * A number already forwarding to Cartesia has its voice verification call answered by the voice
 * agent. That is usable rather than a problem: every call's turns are posted to
 * /api/voice/transcript, so the spoken code lands in the conversation history and can be read from
 * the dashboard — and Cartesia keeps its own recording. It only holds if the number is registered
 * as some business's voicePhoneNumber; otherwise /context answers 404, the agent apologises, and
 * our side records nothing. `--code-method VOICE` chooses that path knowingly; SMS is the default.
 */

const GRAPH = "https://graph.facebook.com/v23.0";

const token = (process.env.META_SYSTEM_USER_TOKEN ?? process.env.TORI_OUTREACH_ACCESS_TOKEN)?.trim();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

// A customer's number lives on the customer's WABA, not Tori's, so every step here has to be able to
// point somewhere else. Defaulting to Tori's keeps the common case a single argument.
const wabaId = (arg("waba") ?? process.env.TORI_WABA_ID ?? process.env.WHATSAPP_WABA_ID)?.trim();

if (!token || !wabaId) {
  console.error("META_SYSTEM_USER_TOKEN and TORI_WABA_ID must both be set in this environment.");
  process.exit(1);
}

const number = arg("number");
// Listing is the one action that answers a question about the WABA rather than about one line, and
// it is also how you find the phone number id that everything else is configured against.
if (!number && !has("list")) {
  console.error("--number is required, in international format, e.g. +972559450126 (or --list)");
  process.exit(1);
}
// Meta wants the country code and the subscriber number as separate fields, not one string.
const digits = (number ?? "").replace(/\D/g, "");
const cc = digits.startsWith("972") ? "972" : digits.slice(0, 3);
const local = digits.slice(cc.length);

async function call(
  path: string,
  body?: Record<string, unknown>,
  method?: "GET" | "POST" | "DELETE"
): Promise<Record<string, unknown>> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const error = json.error as { message?: string; error_user_msg?: string } | undefined;
  if (!res.ok || error) throw new Error(error?.error_user_msg ?? error?.message ?? `HTTP ${res.status}`);
  return json;
}

const FIELDS = "id,display_phone_number,verified_name,status,code_verification_status,name_status,quality_rating";

function describe(r: Record<string, unknown>): string {
  // The id is on its own line and labelled, because it is the value that gets copied into
  // TORI_OUTREACH_PHONE_NUMBER_ID and into every customer's config — and a bare number in a log line
  // is indistinguishable from the phone number next to it.
  return [
    `${r.display_phone_number} — "${r.verified_name}"`,
    `    id ${r.id}`,
    `    line ${r.status} / verification ${r.code_verification_status} / name ${r.name_status ?? "?"}`,
    `    quality ${r.quality_rating ?? "?"}`,
  ].join("\n");
}

async function listNumbers(): Promise<Array<Record<string, unknown>>> {
  const body = await call(`/${wabaId}/phone_numbers?fields=${FIELDS}`);
  return (body.data as Array<Record<string, unknown>>) ?? [];
}

/** The number's row on this WABA, or null if it is not on it yet. */
async function findPhone(): Promise<Record<string, unknown> | null> {
  const match = (await listNumbers()).find(
    (r) => String(r.display_phone_number ?? "").replace(/\D/g, "") === digits
  );
  if (match) console.log(`On the WABA:\n${describe(match)}`);
  return match ?? null;
}

async function main() {
  if (has("list")) {
    const rows = await listNumbers();
    console.log(`WABA ${wabaId} — ${rows.length} number(s):\n`);
    for (const r of rows) console.log(`${describe(r)}\n`);
    return;
  }

  const existing = await findPhone();
  const existingId = existing ? String(existing.id) : null;

  if (has("remove")) {
    if (!existing) throw new Error("Number is not on this WABA — nothing to remove.");
    if (!has("confirm")) {
      console.log(`Would remove ${number} (id ${existingId}) from WABA ${wabaId}. Re-run with --confirm.`);
      return;
    }
    // A refusal rather than a warning, and read from Meta's own state rather than from what the
    // caller believes. The failure this prevents is removing a number that some business is actually
    // serving customers on: the entry is gone, the business's messaging stops, and re-adding it
    // means re-verifying a line whose owner is not sitting next to us.
    //
    // CONNECTED or VERIFIED means the line works. A number that neither sends nor receives is the
    // only kind this will delete.
    const live = existing.status === "CONNECTED" || existing.code_verification_status === "VERIFIED";
    if (live && !has("force")) {
      throw new Error(
        `${number} is ${String(existing.status)}/${String(existing.code_verification_status)} — a working line. ` +
          "Refusing to remove it. If this is genuinely intended, pass --force as well."
      );
    }
    await call(`/${existingId}`, undefined, "DELETE");
    console.log(`✔ Removed ${number} from WABA ${wabaId}.`);
    console.log("  Carrier and voice routing are untouched — this only detaches it from WhatsApp.");
    return;
  }

  if (has("rename")) {
    if (!existingId) throw new Error("Number is not on this WABA yet — add it first.");
    const name = arg("rename");
    if (!name) throw new Error("--rename needs the new display name");
    // A DECLINED name is not retried by asking again with the same name; it needs a different one,
    // and Meta reviews the new one from scratch. The line's own verification is unaffected either
    // way — a number can send and receive with a declined name, it just shows the raw digits.
    await call(`/${existingId}`, { new_display_name: name });
    console.log(`✔ Submitted "${name}" for review. name_status goes PENDING_REVIEW until a person at Meta looks at it.`);
    return;
  }

  if (has("request-code")) {
    if (!existingId) throw new Error("Number is not on this WABA yet — add it first.");
    // VOICE is a deliberate option, not an accident. A number forwarding to Cartesia has its
    // verification call answered by the voice agent — and because every call's turns are posted to
    // /api/voice/transcript, the spoken code lands in the conversation history for that number and
    // can be read from the dashboard. That only holds if the number is some business's
    // voicePhoneNumber: otherwise /context answers 404, the agent apologises, and nothing is
    // recorded on our side. Cartesia keeps its own recording either way.
    const method = (arg("code-method") ?? "SMS").toUpperCase();
    if (method !== "SMS" && method !== "VOICE") throw new Error("--code-method must be SMS or VOICE");
    await call(`/${existingId}/request_code`, { code_method: method, language: "he" });
    console.log(`✔ Verification code requested by ${method}.`);
    console.log(
      method === "VOICE"
        ? "  The agent will answer. Read the code off the call transcript, then re-run with --verify <code>."
        : "  Read it on the phone, then re-run with --verify <code>."
    );
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
