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
 * Sends each number the announcement ONCE, ever. The record is a SystemSetting row keyed by the
 * template name, written after each successful send — so a second run reaches only whoever the
 * first one did not, and re-running after a partial failure is safe rather than a decision. This
 * script had no memory at all until a second broadcast of the same announcement was about to go
 * out to the four people who had already read it: nothing in the code would have stopped it, and
 * a delivered WhatsApp message cannot be recalled.
 *
 * --again ignores that record, for a genuinely new announcement filed under the same template name.
 *
 * Reaches ONLY businesses with a notification phone saved — there is nowhere else to send to. That
 * is also the population for whom the message is true: an owner with no manager number cannot use
 * anything it describes. The ones without a number are counted and named, and they are exactly who
 * announce-update.ts reaches by email with the "set your number first" version instead.
 */

import { prisma } from "../src/lib/prisma.js";
import { sendWhatsAppTemplate } from "../src/webhook/whatsappClient.js";
import { announceTemplate } from "../src/lib/whatsappTemplates.js";
import { normalizeOwnerPhone } from "../src/lib/phone.js";

const confirm = process.argv.includes("--confirm");
const again = process.argv.includes("--again");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? normalizeOwnerPhone(process.argv[onlyIdx + 1] ?? "") ?? undefined : undefined;

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
  const sentKey = `announce:${templateName}:sent`;

  // Phones this announcement has already reached. Stored as a JSON array of normalised numbers;
  // a malformed or missing row reads as "nobody", which errs toward sending rather than toward
  // silently skipping everyone — a run that reaches nobody and says "0 sent" is easy to misread
  // as success.
  const record = await prisma.systemSetting.findUnique({ where: { key: sentKey } });
  let alreadySent: string[] = [];
  try {
    const parsed = record ? JSON.parse(record.value) : [];
    if (Array.isArray(parsed)) alreadySent = parsed.filter((v): v is string => typeof v === "string");
  } catch {
    console.warn(`Could not read ${sentKey} — treating it as empty.`);
  }

  const businesses = await prisma.business.findMany({
    where: { subscriptionStatus: { in: ["active", "trial"] } },
    select: { name: true, notificationPhone: true },
    orderBy: { name: "asc" },
  });

  const withPhone = businesses.filter((b) => b.notificationPhone?.trim());
  const withoutPhone = businesses.length - withPhone.length;

  // Normalised, not merely stripped of punctuation. Stored numbers are not uniformly qualified —
  // the dry run turned up "0525666655", a national number with its trunk zero and no country code,
  // which Meta cannot route. Sending it would have failed for that one business while the run
  // reported success for the rest, and the miss would have been invisible.
  const recipients = withPhone
    .map((b) => ({ name: b.name, phone: normalizeOwnerPhone(b.notificationPhone!) }))
    .filter((r): r is { name: string; phone: string } => r.phone !== null)
    .filter((r) => !only || r.phone === only);

  const repeats = recipients.filter((r) => alreadySent.includes(r.phone));
  const recipientsToSend = again ? recipients : recipients.filter((r) => !alreadySent.includes(r.phone));

  const unroutable = withPhone
    .filter((b) => normalizeOwnerPhone(b.notificationPhone!) === null)
    .map((b) => b.name);

  console.log(`Template:   ${templateName} [${languageCode}] from phone number id ${phoneNumberId}`);
  console.log(`Recipients: ${recipientsToSend.length}`);
  if (repeats.length > 0) {
    console.log(
      again
        ? `Repeats:    ${repeats.length} already received this announcement — --again is sending it to them anyway.`
        : `Already had it: ${repeats.length} — ${repeats.map((r) => r.name).join(", ")}`
    );
  }
  console.log(`Skipped:    ${withoutPhone} business(es) with no manager phone — email reaches those.`);
  if (unroutable.length > 0) {
    console.log(`Unroutable: ${unroutable.length} saved number(s) that are not a valid phone — ${unroutable.join(", ")}`);
  }
  console.log("");
  for (const r of recipientsToSend) console.log(`  ${r.name}  ${r.phone}`);
  console.log("");

  if (!confirm) {
    console.log("Nothing sent. Re-run with --confirm, or --only <phone> to test on one number first.");
    return;
  }
  if (recipientsToSend.length === 0) {
    console.log("Everyone reachable has already had this announcement. Nothing to do.");
    return;
  }

  let sent = 0;
  const failed: string[] = [];
  for (const r of recipientsToSend) {
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
      // Recorded per send, not once at the end: a run that dies halfway must not leave the people
      // it already reached unmarked, or the next run messages them a second time.
      alreadySent.push(r.phone);
      await prisma.systemSetting.upsert({
        where: { key: sentKey },
        create: { key: sentKey, value: JSON.stringify(alreadySent) },
        update: { value: JSON.stringify(alreadySent) },
      });
    } catch (err) {
      failed.push(`${r.name} (${r.phone}): ${err instanceof Error ? err.message : String(err)}`);
    }
    // Slower than the email run. This is one number messaging many people who never asked it to,
    // which is the exact shape WhatsApp scores as spam — and it is the number the whole outreach
    // channel and every provisioned customer setup depends on.
    await sleep(1200);
  }

  console.log(`Sent ${sent} of ${recipientsToSend.length}.`);
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
