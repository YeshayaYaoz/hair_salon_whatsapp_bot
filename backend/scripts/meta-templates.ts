/**
 * Reads what templates a WABA has, and what Meta's pre-approved Template Library offers.
 *
 * Usage (from backend/):
 *   npx tsx scripts/meta-templates.ts             # this WABA's templates, with status and body
 *   npx tsx scripts/meta-templates.ts --waba <id> # a customer's WABA instead of Tori's
 *   npx tsx scripts/meta-templates.ts --discover  # which template edges Graph actually exposes
 *
 * The question this was written to answer was whether Meta's pre-approved Template Library — which
 * would let a business skip the review queue entirely — can be reached from code. It cannot: see
 * the probe results recorded under --library. It is a WhatsApp Manager screen only.
 *
 * That settles the design rather than blocking it. A library template would have to be adopted by
 * hand on every customer's WABA; templates we submit ourselves go through /message_templates, which
 * is already what runs automatically when a business connects. The manual option is the worse one.
 *
 * Read-only.
 */

const GRAPH = "https://graph.facebook.com/v23.0";

const token = (process.env.META_SYSTEM_USER_TOKEN ?? process.env.TORI_OUTREACH_ACCESS_TOKEN)?.trim();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const wabaId = (arg("waba") ?? process.env.TORI_WABA_ID ?? process.env.WHATSAPP_WABA_ID)?.trim();

if (!token || !wabaId) {
  console.error("META_SYSTEM_USER_TOKEN and TORI_WABA_ID must both be set in this environment.");
  process.exit(1);
}

async function call(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const error = json.error as { message?: string; error_user_msg?: string } | undefined;
  if (!res.ok || error) throw new Error(error?.error_user_msg ?? error?.message ?? `HTTP ${res.status}`);
  return json;
}

function bodyOf(t: Record<string, unknown>): string {
  const components = (t.components as Array<Record<string, unknown>>) ?? [];
  const body = components.find((c) => String(c.type).toUpperCase() === "BODY");
  return String(body?.text ?? "").replace(/\s+/g, " ").trim();
}

async function main() {
  if (has("discover")) {
    // Graph answers "Unknown path components: /x" for an edge that does not exist and something
    // else for one that does, so the account itself can be asked which name is real. Cheaper and
    // more reliable than reading docs that lag the API — the first guess here,
    // message_template_libraries, is what the docs' own examples show.
    const candidates = [
      "message_template_libraries",
      "message_template_library",
      "template_libraries",
      "template_library",
      "message_templates",
    ];
    for (const edge of candidates) {
      try {
        const body = await call(`/${wabaId}/${edge}?limit=1`);
        const n = ((body.data as unknown[]) ?? []).length;
        console.log(`✔ /${edge} — exists (${n} row on first page)`);
      } catch (err) {
        console.log(`✖ /${edge} — ${(err as Error).message}`);
      }
    }
    return;
  }

  if (has("library")) {
    // Probed against the live WABA on 2026-08-17, every candidate spelling:
    //   /message_template_libraries  → Unknown path components
    //   /message_template_library    → (#100) Tried accessing nonexisting field
    //   /template_libraries          → Unknown path components
    //   /template_library            → Unknown path components
    //   /message_templates           → exists
    // The Template Library is a WhatsApp Manager screen, not a Graph edge. Adopting a pre-approved
    // template is therefore a manual click per WABA — which for us means per customer, and so worse
    // than submitting our own, which /message_templates does accept and which already runs at
    // connect time for every business.
    throw new Error(
      "Meta does not expose the Template Library over the API — it exists only in WhatsApp Manager. " +
        "Run with --discover to re-check whether that has changed."
    );
  }

  const body = await call(`/${wabaId}/message_templates?limit=100&fields=name,status,category,language,components,rejected_reason`);
  const rows = (body.data as Array<Record<string, unknown>>) ?? [];
  console.log(`WABA ${wabaId} — ${rows.length} template(s):\n`);
  for (const t of rows) {
    console.log(`${t.name} [${t.language}]`);
    console.log(`    ${t.status} / ${t.category}${t.rejected_reason && t.rejected_reason !== "NONE" ? ` — rejected: ${t.rejected_reason}` : ""}`);
    const text = bodyOf(t);
    if (text) console.log(`    body: ${text}`);
    console.log("");
  }
}

main().catch((err) => {
  console.error("✖", (err as Error).message);
  process.exit(1);
});
