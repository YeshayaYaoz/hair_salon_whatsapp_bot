/**
 * Submits the product-announcement MARKETING template to Tori's own WABA.
 *
 * Usage (from backend/):
 *   npx tsx scripts/submit-announce-template.ts             # show what would be submitted
 *   npx tsx scripts/submit-announce-template.ts --confirm   # actually submit it
 *
 * Prints the body with the example substituted before sending, because that substituted text is
 * what Meta's reviewer reads — and a template's wording cannot be edited after approval, only
 * deleted and resubmitted at the cost of another review cycle. This is the last chance to read it.
 */

import { createMessageTemplate } from "../src/webhook/whatsappClient.js";
import {
  announceTemplate,
  ANNOUNCE_TEMPLATE_BODY,
  ANNOUNCE_TEMPLATE_EXAMPLE,
  ANNOUNCE_TEMPLATE_FOOTER,
  ANNOUNCE_TEMPLATE_BUTTON,
} from "../src/lib/whatsappTemplates.js";

const token = (process.env.META_SYSTEM_USER_TOKEN ?? process.env.TORI_OUTREACH_ACCESS_TOKEN)?.trim();
const wabaId = (process.env.TORI_WABA_ID ?? process.env.WHATSAPP_WABA_ID)?.trim();

if (!token || !wabaId) {
  console.error("META_SYSTEM_USER_TOKEN and TORI_WABA_ID must both be set in this environment.");
  process.exit(1);
}

async function main() {
  const { name, languageCode } = announceTemplate();

  console.log(`Template:  ${name} [${languageCode}]  category MARKETING`);
  console.log(`WABA:      ${wabaId}`);
  console.log("");
  console.log("Body with the example substituted in — this is what Meta's reviewer reads:");
  console.log(`  ${ANNOUNCE_TEMPLATE_BODY.replace("{{1}}", ANNOUNCE_TEMPLATE_EXAMPLE[0])}`);
  console.log(`Footer:    ${ANNOUNCE_TEMPLATE_FOOTER}`);
  console.log(`Button:    [${ANNOUNCE_TEMPLATE_BUTTON.text}] → ${ANNOUNCE_TEMPLATE_BUTTON.url}`);
  console.log("");

  if (!process.argv.includes("--confirm")) {
    console.log("Nothing submitted. Re-run with --confirm to send it for review.");
    return;
  }

  const result = await createMessageTemplate(wabaId!, token!, {
    name,
    languageCode,
    bodyText: ANNOUNCE_TEMPLATE_BODY,
    bodyExample: ANNOUNCE_TEMPLATE_EXAMPLE,
    category: "MARKETING",
    footerText: ANNOUNCE_TEMPLATE_FOOTER,
    urlButton: ANNOUNCE_TEMPLATE_BUTTON,
  });

  if (!result.submitted) {
    console.error(`Not submitted: ${result.error}`);
    process.exit(1);
  }
  console.log(`Submitted "${result.name}" for review. Meta answers within a few hours, usually.`);
  console.log("Once it is APPROVED, set TORI_ANNOUNCE_TEMPLATE_NAME only if you changed the name.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
