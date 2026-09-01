/**
 * Sends the announcement template on WhatsApp, from Tori's own number to each owner's phone.
 *
 * Usage (from backend/, against the environment holding the database):
 *   railway run npx tsx scripts/announce-whatsapp.ts                    # list who would receive it
 *   railway run npx tsx scripts/announce-whatsapp.ts --only 972501234567
 *   railway run npx tsx scripts/announce-whatsapp.ts --confirm
 *
 * The counterpart to announce-update.ts, and the same dry-run-by-default rule: the dry run prints
 * the recipient list, because the failure that matters is not "the send breaks" but "the send
 * works, on the wrong list", and a delivered WhatsApp message cannot be recalled.
 *
 * Reaches ONLY businesses with a notification phone saved — there is nowhere else to send to. That
 * is also the population for whom the message is true: an owner with no manager number cannot use
 * anything it describes. The ones without a number are counted and named, and they are exactly who
 * announce-update.ts reaches by email with the "set your number first" version instead.
 */

import { prisma } from "../src/lib/prisma.js";
import { sendWhatsAppTemplate } from "../src/webhook/whatsappClient.js";
import { announceTemplate } from "../src/lib/whatsappTemplates.js";

const confirm = process.argv.includes("--confirm");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1]?.replace(/\D/g, "") : undefined;

// Tori's own outreach number, never a customer's: this goes out from us, about us.
const phoneNumberId = process.env.TORI_OUTREACH_PHONE_NUMBER_ID?.trim();
const accessToken = process.env.TORI_OUTREACH_ACCESS_TOKEN?.trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!phoneNumberId || !accessToken) {
    console.error("TORI_OUTREACH_PHONE_NUMBER_ID and TORI_OUTREACH_ACCESS_TOKEN must both be set.");
    process.exit(1);
  }

  const { name: templateName, languageCode } = announceTemplate();

  const businesses = await prisma.business.findMany({
    where: { subscriptionStatus: { in: ["active", "trial"] } },
    select: { name: true, notificationPhone: true },
    orderBy: { name: "asc" },
  });

  const withPhone = businesses.filter((b) => b.notificationPhone?.trim());
  const withoutPhone = businesses.length - withPhone.length;

  const recipients = withPhone
    .map((b) => ({ name: b.name, phone: b.notificationPhone!.replace(/\D/g, "") }))
    .filter((r) => r.phone.length > 0 && (!only || r.phone === only));

  console.log(`Template:   ${templateName} [${languageCode}] from phone number id ${phoneNumberId}`);
  console.log(`Recipients: ${recipients.length}`);
  console.log(`Skipped:    ${withoutPhone} business(es) with no manager phone — email reaches those.`);
  console.log("");
  for (const r of recipients) console.log(`  ${r.name}  ${r.phone}`);
  console.log("");

  if (!confirm) {
    console.log("Nothing sent. Re-run with --confirm, or --only <phone> to test on one number first.");
    return;
  }

  let sent = 0;
  const failed: string[] = [];
  for (const r of recipients) {
    try {
      await sendWhatsAppTemplate({
        phoneNumberId,
        accessToken,
        to: r.phone,
        templateName,
        languageCode,
        // The one variable is the business's own name. Every recipient sees their own here; the
        // "מספרת רונית" in the template definition is only the sample Meta's reviewer is shown.
        bodyParams: [r.name],
      });
      sent++;
    } catch (err) {
      failed.push(`${r.name} (${r.phone}): ${err instanceof Error ? err.message : String(err)}`);
    }
    // Slower than the email run. This is one number messaging many people who never asked it to,
    // which is the exact shape WhatsApp scores as spam — and it is the number the whole outreach
    // channel and every provisioned customer setup depends on.
    await sleep(1200);
  }

  console.log(`Sent ${sent} of ${recipients.length}.`);
  if (failed.length > 0) {
    console.log("Failed:");
    for (const f of failed) console.log(`  - ${f}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
