/**
 * Sends ONE sample receipt message to a phone, from Tori's own number, so a prospect sees what
 * their customers would get. No document is issued and nothing is written: the button carries
 * the "sample" id, which the /r route answers without touching the database.
 *
 * Usage: railway run npx tsx scripts/send-sample-receipt.ts --to 0501234567 --name ינון [--confirm]
 * Without --confirm it prints the exact message and sends nothing.
 */
import { sendWhatsAppTemplate } from "../src/webhook/whatsappClient.js";
import { receiptTemplate, RECEIPT_BODY } from "../src/lib/whatsappTemplates.js";
import { SAMPLE_RECEIPT_ID } from "../src/lib/receiptRedirect.js";
import { normalizePhone } from "../src/lib/phone.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const toRaw = arg("to");
  if (!toRaw) throw new Error("--to is required");
  const to = normalizePhone(toRaw);
  const name = arg("name")?.trim() || "שלום";
  const params = [name, arg("business") ?? "מספרת הדמו של תורי", arg("for") ?? "תספורת", arg("amount") ?? "120"];

  let text = RECEIPT_BODY;
  params.forEach((v, i) => (text = text.replace(`{{${i + 1}}}`, v)));
  console.log(`To ${to}, from Tori's number, template ${receiptTemplate().name}:\n\n  ${text}\n  [לקבלה] → /r/${SAMPLE_RECEIPT_ID}\n`);

  if (!process.argv.includes("--confirm")) {
    console.log("Nothing sent. Re-run with --confirm.");
    return;
  }
  const phoneNumberId = process.env.TORI_OUTREACH_PHONE_NUMBER_ID?.trim();
  const accessToken = process.env.TORI_OUTREACH_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !accessToken) throw new Error("TORI_OUTREACH_PHONE_NUMBER_ID / TORI_OUTREACH_ACCESS_TOKEN are not set.");
  const t = receiptTemplate();
  const receipt = await sendWhatsAppTemplate({
    phoneNumberId, accessToken, to, kind: "sample-receipt",
    templateName: t.name, languageCode: t.languageCode, bodyParams: params, urlSuffix: SAMPLE_RECEIPT_ID,
  });
  console.log(`✔ Accepted by WhatsApp (message ${receipt.messageId ?? "?"}). Accepted is not delivered.`);
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
