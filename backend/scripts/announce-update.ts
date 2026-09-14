/**
 * Emails every live business the "you can now run the business from WhatsApp" announcement.
 *
 * Usage (from backend/, against the environment holding the database):
 *   railway run npx tsx scripts/announce-update.ts                  # list who would receive it
 *   railway run npx tsx scripts/announce-update.ts --confirm        # send
 *   railway run npx tsx scripts/announce-update.ts --only a@b.com   # send to one address (a test)
 *
 * Dry run by default, and the dry run prints the actual recipient list rather than a count: the
 * failure this guards against is not "the send breaks" but "the send works, on the wrong list",
 * and that one is unrecoverable — mail cannot be recalled.
 *
 * Reaches each address ONCE, ever — see lib/announceRecord. --again ignores that record for a
 * genuinely new announcement, and --mark-sent records everyone without sending, which is how an
 * announcement that went out before the record existed stops being a duplicate waiting to happen.
 *
 * Sends serially with a small gap. A burst of a few hundred messages is what makes a sending
 * domain look like a spam source, and the domain here also carries password resets and booking
 * notifications for paying customers.
 */

import { prisma } from "../src/lib/prisma.js";
import { sendManageFromWhatsAppEmail } from "../src/lib/email.js";
import { loadAnnounceRecord, markAnnounceSent } from "../src/lib/announceRecord.js";

const confirm = process.argv.includes("--confirm");
const again = process.argv.includes("--again");
const markOnly = process.argv.includes("--mark-sent");

/** Names this announcement in the record. Fixed, not derived — the copy may be edited, but it is
 * still the same thing being announced, and a rename here would re-send it to everyone. */
const ANNOUNCEMENT = "manage_from_whatsapp";
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1]?.trim().toLowerCase() : undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const businesses = await prisma.business.findMany({
    // Cancelled accounts are not customers, and announcing a feature to someone who left reads as
    // not noticing they left. Trials are included: this is exactly what a trial should see.
    where: { subscriptionStatus: { in: ["active", "trial"] } },
    select: { id: true, name: true, email: true, notificationPhone: true },
    orderBy: { name: "asc" },
  });

  const recipients = businesses
    .filter((b) => b.email && (!only || b.email.toLowerCase() === only))
    .map((b) => ({
      email: b.email!,
      name: b.name,
      // Drives which call to action the mail carries — see sendManageFromWhatsAppEmail.
      managerPhoneSet: Boolean(b.notificationPhone?.trim()),
    }));

  const record = await loadAnnounceRecord("email", ANNOUNCEMENT);
  const addressOf = (r: { email: string }) => r.email.toLowerCase();
  const repeats = recipients.filter((r) => record.sent.includes(addressOf(r)));
  const toSend = again ? recipients : recipients.filter((r) => !record.sent.includes(addressOf(r)));

  const noPhone = toSend.filter((r) => !r.managerPhoneSet).length;
  console.log(`${toSend.length} recipient(s); ${noPhone} of them have no manager phone saved yet.`);
  if (repeats.length > 0) {
    console.log(
      again
        ? `Repeats:   ${repeats.length} already had this — --again is sending it again anyway.`
        : `Already had it: ${repeats.length} — ${repeats.map((r) => r.name).join(", ")}`
    );
  }
  console.log("");
  for (const r of toSend) {
    console.log(`  ${r.managerPhoneSet ? "✓" : "·"} ${r.name}  <${r.email}>`);
  }
  console.log("");

  if (markOnly) {
    await markAnnounceSent(record, recipients.map(addressOf));
    console.log(`Marked ${recipients.length} recipient(s) as already having received this. Nothing was sent.`);
    return;
  }
  if (!confirm) {
    console.log("Nothing sent. Re-run with --confirm to send, or --only <email> to test on one address first.");
    return;
  }

  if (toSend.length === 0) {
    console.log("Everyone reachable has already had this announcement. Nothing to do.");
    return;
  }

  let sent = 0;
  const failed: string[] = [];
  for (const r of toSend) {
    try {
      await sendManageFromWhatsAppEmail(r.email, r.name, r.managerPhoneSet);
      sent++;
      // Per send, not once at the end: a run that dies halfway must not leave the addresses it
      // already reached unmarked.
      await markAnnounceSent(record, [addressOf(r)]);
    } catch (err) {
      // One bad address must not stop the run: the remaining businesses have done nothing wrong,
      // and a half-sent announcement with no record of where it stopped is the worst outcome here.
      failed.push(`${r.email}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(400);
  }

  console.log(`Sent ${sent} of ${toSend.length}.`);
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
