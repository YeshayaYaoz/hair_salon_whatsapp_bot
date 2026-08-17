/**
 * Resubmits a business's four templates to its WABA.
 *
 * Usage (from backend/, against the environment holding the database):
 *   railway run npx tsx scripts/resubmit-templates.ts --list
 *   railway run npx tsx scripts/resubmit-templates.ts --business <id>
 *   railway run npx tsx scripts/resubmit-templates.ts --business <id> --confirm
 *
 * Deliberately calls submitWhatsAppTemplates — the same function the connect flow runs — rather
 * than reimplementing it. Two paths that submit templates would drift, and drift between "what
 * happens automatically" and "what happens when we fix it by hand" is how a business ends up with
 * templates nobody can account for.
 *
 * Needed because the fix for a rejected template is not visible from inside the product: the
 * wording and the missing example values were both corrected in code, but Meta still holds the old
 * rejected template until something asks it again.
 */

import { prisma } from "../src/lib/prisma.js";
import { submitWhatsAppTemplates } from "../src/lib/submitTemplates.js";
import { decryptSecret } from "../src/lib/crypto.js";
import { wordingFor, OWNER_ALERT_TEXT } from "../src/lib/whatsappTemplates.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  if (has("list") || !arg("business")) {
    const rows = await prisma.business.findMany({
      select: { id: true, name: true, businessType: true, whatsappWabaId: true, whatsappPhoneNumberId: true },
      orderBy: { name: "asc" },
    });
    console.log("Businesses:\n");
    for (const r of rows) {
      console.log(`  ${r.id}  ${r.name}`);
      console.log(`      type ${r.businessType ?? "—"}  waba ${r.whatsappWabaId ?? "—"}  phone ${r.whatsappPhoneNumberId ?? "—"}`);
    }
    console.log("\nRe-run with --business <id> to see what would be submitted.");
    return;
  }

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: arg("business") },
    select: {
      id: true,
      name: true,
      businessType: true,
      whatsappWabaId: true,
      whatsappPhoneNumberId: true,
      whatsappAccessToken: true,
    },
  });

  if (!business.whatsappPhoneNumberId || !business.whatsappAccessToken) {
    throw new Error(`${business.name} has no connected WhatsApp number.`);
  }

  const wording = wordingFor(business.businessType);
  console.log(`${business.name} — type ${business.businessType ?? "unset"} — WABA ${business.whatsappWabaId ?? "(will be resolved)"}\n`);
  // Printed before sending, because an approved template's wording cannot be edited afterwards —
  // only deleted and resubmitted, at another review cycle.
  for (const [label, t] of [
    ["reminder", wording.reminder],
    ["review", wording.review],
    ["confirmation", wording.confirmation],
    ["owner alert", OWNER_ALERT_TEXT],
  ] as const) {
    let filled = t.body;
    t.example.forEach((v, i) => (filled = filled.replace(`{{${i + 1}}}`, v)));
    console.log(`  ${label}:`);
    console.log(`    ${filled}`);
  }
  console.log("");

  if (!has("confirm")) {
    console.log("Nothing submitted. Re-run with --confirm.");
    return;
  }

  const results = await submitWhatsAppTemplates(
    business.id,
    business.whatsappPhoneNumberId,
    decryptSecret(business.whatsappAccessToken),
    business.whatsappWabaId
  );

  if (!results) {
    // submitWhatsAppTemplates swallows its errors by design — it must never fail the WhatsApp
    // connection that just succeeded. Here that design is wrong for the caller, so it is surfaced.
    throw new Error("Submission failed — see the logged error above.");
  }

  let failed = 0;
  for (const r of results) {
    if (r.submitted) {
      console.log(`✔ ${r.name} — ${r.status ?? "PENDING"}`);
    } else {
      failed += 1;
      console.log(`✖ ${r.name} — ${r.error}`);
    }
  }
  console.log("");
  console.log("PENDING means Meta is reviewing; approval takes up to ~24h.");
  if (failed) process.exit(1);
}

main()
  .catch((err) => {
    console.error("✖", (err as Error).message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
