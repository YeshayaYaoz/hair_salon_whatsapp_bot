/**
 * Submits the product-announcement MARKETING template to Tori's own WABA.
 *
 * Usage (from backend/):
 *   npx tsx scripts/submit-announce-template.ts                       # marketing variant, dry run
 *   npx tsx scripts/submit-announce-template.ts --utility --confirm   # utility variant, submitted
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
  announceUtilityTemplate,
  ANNOUNCE_UTILITY_TEMPLATE_BODY,
  ANNOUNCE_UTILITY_TEMPLATE_EXAMPLE,
  ANNOUNCE_UTILITY_TEMPLATE_BUTTON,
} from "../src/lib/whatsappTemplates.js";

// Which of the two announcement templates to submit. They differ in category, and the category is
// not a label: it decides whether a recipient who opted out of marketing ever sees the message.
const utility = process.argv.includes("--utility");
const variant = utility
  ? {
      ...announceUtilityTemplate(),
      category: "UTILITY" as const,
      body: ANNOUNCE_UTILITY_TEMPLATE_BODY,
      example: ANNOUNCE_UTILITY_TEMPLATE_EXAMPLE,
      footer: undefined,
      button: ANNOUNCE_UTILITY_TEMPLATE_BUTTON,
    }
  : {
      ...announceTemplate(),
      category: "MARKETING" as const,
      body: ANNOUNCE_TEMPLATE_BODY,
      example: ANNOUNCE_TEMPLATE_EXAMPLE,
      footer: ANNOUNCE_TEMPLATE_FOOTER,
      button: ANNOUNCE_TEMPLATE_BUTTON,
    };

const token = (process.env.META_SYSTEM_USER_TOKEN ?? process.env.TORI_OUTREACH_ACCESS_TOKEN)?.trim();
const wabaId = (process.env.TORI_WABA_ID ?? process.env.WHATSAPP_WABA_ID)?.trim();

if (!token || !wabaId) {
  console.error("META_SYSTEM_USER_TOKEN and TORI_WABA_ID must both be set in this environment.");
  process.exit(1);
}

async function main() {
  const { name, languageCode, category, body, example, footer, button } = variant;

  console.log(`Template:  ${name} [${languageCode}]  category ${category}`);
  console.log(`WABA:      ${wabaId}`);
  console.log("");
  console.log("Body with the example substituted in — this is what Meta's reviewer reads:");
  console.log(`  ${body.replace("{{1}}", example[0])}`);
  if (footer) console.log(`Footer:    ${footer}`);
  console.log(`Button:    [${button.text}] → ${button.url}`);
  console.log("");

  if (!process.argv.includes("--confirm")) {
    console.log("Nothing submitted. Re-run with --confirm to send it for review.");
    return;
  }

  const result = await createMessageTemplate(wabaId!, token!, {
    name,
    languageCode,
    bodyText: body,
    bodyExample: example,
    category,
    footerText: footer,
    urlButton: button,
  });

  if (!result.submitted) {
    console.error(`Not submitted: ${result.error}`);
    process.exit(1);
  }
  console.log(`Submitted "${result.name}" for review. Meta answers within a few hours, usually.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
