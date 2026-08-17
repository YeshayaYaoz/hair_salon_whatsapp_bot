/**
 * Submits Tori's own cold-outreach MARKETING template to Tori's WABA.
 *
 * Usage (from backend/):
 *   npx tsx scripts/submit-outreach-template.ts            # show what would be submitted
 *   npx tsx scripts/submit-outreach-template.ts --confirm   # actually submit it
 *
 * A one-off rather than part of the connect flow, because this template belongs to exactly one WABA
 * — ours. Customers' templates are submitted automatically when they connect; this one has no such
 * moment, and re-submitting it on every deploy would put a template into review repeatedly.
 *
 * Prints the body before sending. A template's wording cannot be edited after approval — only
 * deleted and resubmitted, at another review cycle — so the last chance to read it is here.
 */

import { createMessageTemplate } from "../src/webhook/whatsappClient.js";
import {
  outreachTemplate,
  OUTREACH_TEMPLATE_BODY,
  OUTREACH_TEMPLATE_EXAMPLE,
  OUTREACH_TEMPLATE_FOOTER,
  OUTREACH_TEMPLATE_BUTTONS,
} from "../src/lib/whatsappTemplates.js";

const token = (process.env.META_SYSTEM_USER_TOKEN ?? process.env.TORI_OUTREACH_ACCESS_TOKEN)?.trim();
const wabaId = (process.env.TORI_WABA_ID ?? process.env.WHATSAPP_WABA_ID)?.trim();

if (!token || !wabaId) {
  console.error("META_SYSTEM_USER_TOKEN and TORI_WABA_ID must both be set in this environment.");
  process.exit(1);
}

async function main() {
  const { name, languageCode } = outreachTemplate();

  console.log(`Template:  ${name} [${languageCode}]  category MARKETING`);
  console.log(`WABA:      ${wabaId}`);
  console.log("");
  console.log("Body:");
  console.log(`  ${OUTREACH_TEMPLATE_BODY}`);
  console.log("Body with the example substituted in — this is what Meta's reviewer reads:");
  console.log(`  ${OUTREACH_TEMPLATE_BODY.replace("{{1}}", OUTREACH_TEMPLATE_EXAMPLE[0])}`);
  console.log(`Footer:    ${OUTREACH_TEMPLATE_FOOTER}`);
  console.log(`Buttons:   ${OUTREACH_TEMPLATE_BUTTONS.join(", ")}`);
  console.log("");

  if (!process.argv.includes("--confirm")) {
    console.log("Nothing submitted. Re-run with --confirm to send it for review.");
    return;
  }

  const result = await createMessageTemplate(wabaId!, token!, {
    name,
    languageCode,
    bodyText: OUTREACH_TEMPLATE_BODY,
    bodyExample: OUTREACH_TEMPLATE_EXAMPLE,
    category: "MARKETING",
    footerText: OUTREACH_TEMPLATE_FOOTER,
    quickReplies: OUTREACH_TEMPLATE_BUTTONS,
  });

  if (!result.submitted) {
    console.error(`✖ Not submitted: ${result.error}`);
    process.exit(1);
  }
  console.log(`✔ Submitted. Meta's initial status: ${result.status ?? "PENDING"}`);
  console.log(`  Set TORI_OUTREACH_TEMPLATE_NAME=${name} once it is APPROVED — sending against a`);
  console.log("  template still in review fails, and the outreach channel reports it as a send error.");
}

main().catch((err) => {
  console.error("✖", (err as Error).message);
  process.exit(1);
});
