/**
 * Sends one approved template to one number, and prints the message id Meta returns.
 *
 * Usage (from backend/, against the environment holding the credentials):
 *   railway run npx tsx scripts/send-test-template.ts --to 972501234567 --template tori_owner_alert --param "בדיקה"
 *
 * Exists to separate "the account cannot send" from "this particular message was dropped". Those
 * look identical from the send endpoint — both return 200 — and the account-level checks
 * (meta-delivery-diagnose) can report AVAILABLE while a specific message still never lands.
 *
 * The distinction it was written for: Meta silently drops MARKETING templates to a recipient who
 * has opted out of marketing, while UTILITY templates to the same number continue to arrive. No
 * error, no webhook to us, nothing in the send log. Sending one of each is the only way to tell
 * that apart from an account problem, and the message id printed here is what a support case needs.
 */

import { sendWhatsAppTemplate } from "../src/webhook/whatsappClient.js";
import { normalizeOwnerPhone } from "../src/lib/phone.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const phoneNumberId = process.env.TORI_OUTREACH_PHONE_NUMBER_ID?.trim();
const accessToken = process.env.TORI_OUTREACH_ACCESS_TOKEN?.trim();
const to = normalizeOwnerPhone(arg("to") ?? "");
const templateName = arg("template");
const param = arg("param");
const languageCode = arg("lang") ?? "he";

async function main() {
  if (!phoneNumberId || !accessToken) {
    console.error("TORI_OUTREACH_PHONE_NUMBER_ID and TORI_OUTREACH_ACCESS_TOKEN must both be set.");
    process.exit(1);
  }
  if (!to) {
    console.error("--to needs a phone number that can be qualified, e.g. 972501234567 or 0501234567");
    process.exit(1);
  }
  if (!templateName) {
    console.error("--template needs the name of a template APPROVED on this WABA");
    process.exit(1);
  }

  console.log(`Sending ${templateName} [${languageCode}] to ${to} from phone number id ${phoneNumberId}`);
  await sendWhatsAppTemplate({
    phoneNumberId,
    accessToken,
    to,
    templateName,
    languageCode,
    bodyParams: param === undefined ? [] : [param],
  });
  // A 200 here means queued, not delivered. Whether it lands is what the recipient's handset says.
  console.log("Accepted by Meta. Check the handset — acceptance is not delivery.");
}

main().catch((err) => {
  console.error(`Refused by Meta: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
