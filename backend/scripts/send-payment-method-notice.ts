/**
 * Tells one business owner that their Tori account has no payment method saved.
 *
 * Usage (from backend/, against the environment holding the credentials):
 *   railway run npx tsx scripts/send-payment-method-notice.ts --business <id> [--to 0501234567] --confirm
 *
 * Sends tori_payment_method from TORI's own number, never from the business's. Two reasons, and
 * both matter: the template is approved on Tori's WABA, and this is a message from Tori about a
 * Tori account — sending it out of the business's own line would put it in the same thread their
 * guests use, from the number their guests know.
 *
 * The state is checked before the claim is made. Telling an owner they have no card when they do
 * is worse than saying nothing: it sends them to re-enter details they already gave, and it is the
 * exact shape of a phishing message, from a number they have no particular reason to trust.
 */

import { prisma } from "../src/lib/prisma.js";
import { normalizeOwnerPhone } from "../src/lib/phone.js";
import { sendWhatsAppTemplate } from "../src/webhook/whatsappClient.js";
import { paymentDetailsTemplate, PAYMENT_DETAILS_BODY, PAYMENT_DETAILS_BUTTON } from "../src/lib/whatsappTemplates.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const businessId = arg("business");
  if (!businessId) {
    console.error("--business needs a business id");
    process.exit(1);
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      name: true,
      email: true,
      notificationPhone: true,
      subscriptionStatus: true,
      subscriptionPlan: true,
      subscriptionToken: true,
    },
  });
  if (!business) {
    console.error(`No business ${businessId}`);
    process.exit(1);
  }

  console.log(`${business.name}`);
  console.log(`  subscription: ${business.subscriptionStatus} / ${business.subscriptionPlan ?? "no plan"}`);
  console.log(`  payment method: ${business.subscriptionToken ? "SAVED" : "none"}`);
  console.log(`  notification phone: ${business.notificationPhone ?? "none"}`);
  console.log("");

  if (business.subscriptionToken) {
    console.error("This business already has a payment method saved — the message would be false. Refusing.");
    process.exit(1);
  }

  const to = normalizeOwnerPhone(arg("to") ?? business.notificationPhone ?? "");
  if (!to) {
    console.error("No usable number: pass --to, or set a notificationPhone on the business.");
    process.exit(1);
  }

  const phoneNumberId = process.env.TORI_OUTREACH_PHONE_NUMBER_ID?.trim();
  const accessToken = process.env.TORI_OUTREACH_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !accessToken) {
    console.error("TORI_OUTREACH_PHONE_NUMBER_ID and TORI_OUTREACH_ACCESS_TOKEN must both be set.");
    process.exit(1);
  }

  const template = paymentDetailsTemplate();
  console.log(`Would send '${template.name}' to ${to}:`);
  console.log(`  ${PAYMENT_DETAILS_BODY.replace("{{1}}", business.name)}`);
  console.log(`  button: [${PAYMENT_DETAILS_BUTTON.text}] → ${PAYMENT_DETAILS_BUTTON.url}`);
  console.log("");

  if (!process.argv.includes("--confirm")) {
    console.log("Dry run. Re-run with --confirm to actually send.");
    return;
  }

  await sendWhatsAppTemplate({
    phoneNumberId,
    accessToken,
    to,
    templateName: template.name,
    languageCode: template.languageCode,
    bodyParams: [business.name],
  });
  console.log("Accepted by Meta. Acceptance is not delivery — the handset is the answer.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
