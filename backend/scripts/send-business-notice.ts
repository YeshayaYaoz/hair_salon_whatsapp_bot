/**
 * Emails one business a message from the operator.
 *
 * Usage (from backend/, against the environment holding the mail credentials):
 *   railway run npx tsx scripts/send-business-notice.ts --business <id> --file notice.txt
 *   railway run npx tsx scripts/send-business-notice.ts --business <id> --file notice.txt --confirm
 *
 * For the case the announcement scripts do not cover: one specific business, one specific message,
 * written for them. Dry run by default, printing the recipient and the exact text, because the
 * failure worth guarding against is not "the send breaks" but "the send works, to the wrong
 * business" — and mail cannot be recalled.
 *
 * Email only, on purpose. A business with a manager number saved is better reached on WhatsApp
 * through notifyOwner; this exists for the ones without one, which is also the population most
 * likely to need telling that they should set one.
 */

import { readFileSync } from "fs";
import { prisma } from "../src/lib/prisma.js";
import { sendBusinessNoticeEmail } from "../src/lib/email.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const businessId = arg("business");
  const file = arg("file");
  if (!businessId || !file) {
    console.error("Needs --business <id> and --file <path to the message text>");
    process.exit(1);
  }
  const text = readFileSync(file, "utf8").trim();
  if (!text) {
    console.error("The message file is empty.");
    process.exit(1);
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true, email: true, notificationPhone: true, subscriptionStatus: true },
  });
  if (!business) {
    console.error(`No business ${businessId}`);
    process.exit(1);
  }

  console.log(`${business.name}  <${business.email}>  — ${business.subscriptionStatus}, manager phone: ${business.notificationPhone ?? "none"}`);
  console.log("");
  console.log(text.split("\n").map((l) => `  │ ${l}`).join("\n"));
  console.log("");

  if (!process.argv.includes("--confirm")) {
    console.log("Nothing sent. Re-run with --confirm to send.");
    return;
  }
  await sendBusinessNoticeEmail(business.email, business.name, text);
  console.log(`Sent to ${business.email}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
