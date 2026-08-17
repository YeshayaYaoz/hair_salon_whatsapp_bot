/**
 * Reads what templates a WABA has, and what Meta's pre-approved Template Library offers.
 *
 * Usage (from backend/):
 *   npx tsx scripts/meta-templates.ts                     # our templates on Tori's WABA
 *   npx tsx scripts/meta-templates.ts --library           # Meta's ready-made catalogue
 *   npx tsx scripts/meta-templates.ts --library --lang he # only the Hebrew ones
 *   npx tsx scripts/meta-templates.ts --waba <id>         # a customer's WABA instead
 *
 * Why the library matters: a template we write ourselves goes into a review queue and can come back
 * REJECTED for reasons that are not visible from the body text — and every rejection is days. A
 * library template is pre-approved, so adopting one is instant. The catch is that the body is fixed;
 * it cannot be edited, only adopted as-is.
 *
 * Read-only. Adopting a library template is a separate, deliberate action.
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
    const lang = arg("lang");
    // The library is a Graph edge like any other. Paging matters: the catalogue is long, and taking
    // only the first page would silently answer "there is no marketing template" when there is one
    // three pages in.
    let path = `/${wabaId}/message_template_libraries?limit=100`;
    let page = 0;
    let shown = 0;
    while (path && page < 20) {
      const body = await call(path);
      const rows = (body.data as Array<Record<string, unknown>>) ?? [];
      for (const t of rows) {
        const langs = (t.supported_languages as string[]) ?? [];
        if (lang && !langs.includes(lang)) continue;
        shown += 1;
        console.log(`${t.name}`);
        console.log(`    category ${t.category ?? "?"}  languages ${langs.join(", ") || "?"}`);
        const text = bodyOf(t);
        if (text) console.log(`    body: ${text}`);
        console.log("");
      }
      const paging = body.paging as { next?: string; cursors?: { after?: string } } | undefined;
      const after = paging?.cursors?.after;
      path = paging?.next && after ? `/${wabaId}/message_template_libraries?limit=100&after=${after}` : "";
      page += 1;
    }
    console.log(`${shown} library template(s)${lang ? ` supporting ${lang}` : ""}.`);
    return;
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
