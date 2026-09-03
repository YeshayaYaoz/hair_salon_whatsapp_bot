/**
 * Submits the two owner-facing UTILITY templates that carry a button: the alert with a dashboard
 * link, and the request to complete payment details.
 *
 * Usage (from backend/):
 *   npx tsx scripts/submit-owner-templates.ts             # print what would be submitted
 *   npx tsx scripts/submit-owner-templates.ts --confirm   # submit both
 *   npx tsx scripts/submit-owner-templates.ts --only tori_payment_details --confirm
 *
 * Both are genuinely utility — one reports an event on the owner's account, the other asks for an
 * action on it — which is what lets them carry a link at all. The announcement templates could
 * not: Meta classifies on what the message does, and "here is a new capability" is marketing
 * whatever the wording, as it reclassified tori_service_update_manage to prove.
 *
 * Prints each body with its example substituted before sending, because that is what the reviewer
 * reads and an approved template's wording cannot be edited afterwards.
 */

import { createMessageTemplate } from "../src/webhook/whatsappClient.js";
import {
  ownerAlertCtaTemplate,
  OWNER_ALERT_CTA_BODY,
  OWNER_ALERT_CTA_EXAMPLE,
  OWNER_ALERT_CTA_BUTTON,
  paymentDetailsTemplate,
  PAYMENT_DETAILS_BODY,
  PAYMENT_DETAILS_EXAMPLE,
  PAYMENT_DETAILS_BUTTON,
} from "../src/lib/whatsappTemplates.js";

const token = (process.env.META_SYSTEM_USER_TOKEN ?? process.env.TORI_OUTREACH_ACCESS_TOKEN)?.trim();
const wabaId = (process.env.TORI_WABA_ID ?? process.env.WHATSAPP_WABA_ID)?.trim();

if (!token || !wabaId) {
  console.error("META_SYSTEM_USER_TOKEN and TORI_WABA_ID must both be set in this environment.");
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const templates = [
  {
    ...ownerAlertCtaTemplate(),
    body: OWNER_ALERT_CTA_BODY,
    example: OWNER_ALERT_CTA_EXAMPLE,
    button: OWNER_ALERT_CTA_BUTTON,
  },
  {
    ...paymentDetailsTemplate(),
    body: PAYMENT_DETAILS_BODY,
    example: PAYMENT_DETAILS_EXAMPLE,
    button: PAYMENT_DETAILS_BUTTON,
  },
];

async function main() {
  const only = arg("only");
  const chosen = only ? templates.filter((t) => t.name === only) : templates;
  if (chosen.length === 0) {
    console.error(`No template named "${only}". Known: ${templates.map((t) => t.name).join(", ")}`);
    process.exit(1);
  }

  for (const t of chosen) {
    console.log(`${t.name} [${t.languageCode}]  category UTILITY`);
    console.log(`  ${t.body.replace("{{1}}", t.example[0])}`);
    console.log(`  Button: [${t.button.text}] → ${t.button.url}`);
    console.log("");
  }

  if (!process.argv.includes("--confirm")) {
    console.log("Nothing submitted. Re-run with --confirm.");
    return;
  }

  let failed = false;
  for (const t of chosen) {
    const result = await createMessageTemplate(wabaId!, token!, {
      name: t.name,
      languageCode: t.languageCode,
      bodyText: t.body,
      bodyExample: t.example,
      category: "UTILITY",
      urlButton: t.button,
    });
    if (result.submitted) {
      console.log(`✔ ${t.name} submitted for review.`);
    } else {
      // Reported, not thrown: one rejected template must not stop the other from being filed.
      console.error(`✖ ${t.name}: ${result.error}`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
