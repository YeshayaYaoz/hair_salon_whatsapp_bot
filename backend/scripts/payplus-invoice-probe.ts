/**
 * Asks PayPlus חשבונית+ to PREVIEW a receipt for a business, and prints their raw answer.
 *
 * Usage: railway run npx tsx scripts/payplus-invoice-probe.ts --business <id> [--confirm]
 *
 * preview:true per their reference — nothing is filed in the business's books. With --confirm the
 * preview flag is dropped and a real ₪1 receipt is issued, which is an accounting document.
 * Prints status and body verbatim, credentials never. Exists because the bot's paraphrase of the
 * refusal ("missing document settings") is not enough to know which setting.
 */
import { prisma } from "../src/lib/prisma.js";
import { decryptSecret } from "../src/lib/crypto.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const confirm = process.argv.includes("--confirm");

async function main() {
  const id = arg("business");
  if (!id) throw new Error("--business <id> is required");
  const b = await prisma.business.findUniqueOrThrow({
    where: { id },
    select: { name: true, paymentProvider: true, invoiceProvider: true, paymentApiKey: true, paymentApiSecret: true, notificationPhone: true },
  });
  if (b.invoiceProvider !== "payplus-invoice" || !b.paymentApiKey || !b.paymentApiSecret) {
    throw new Error(`${b.name}: invoice provider is ${b.invoiceProvider ?? "none"} — this probe is for payplus-invoice.`);
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
  const body = {
    doc_date: today,
    language: "he",
    currency_code: "ILS",
    vatType: "vat-type-included",
    ...(confirm ? {} : { preview: true }),
    customer: { customer_name: "בדיקה תורי", name: "בדיקה תורי", email: "probe@noemail.torionline.com", phone: b.notificationPhone ?? undefined },
    items: [{ name: "בדיקת חיבור", quantity: 1, price: 1, vat_type_code: "vat-type-included", currency_code: "ILS" }],
    payments: [{ payment_type: "other", payment_date: today, amount: 1, currency_code: "ILS" }],
    totalAmount: 1,
    send_document_email: false,
    prevent_email: true,
    send_document_sms: false,
  };
  console.log(`${b.name} — ${confirm ? "REAL ₪1 receipt" : "preview only"} via inv_receipt`);
  const res = await fetch("https://restapi.payplus.co.il/api/v1.0/books/docs/new/inv_receipt", {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": decryptSecret(b.paymentApiKey), "secret-key": decryptSecret(b.paymentApiSecret) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log(text.slice(0, 3000));
}

main()
  .catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); })
  .finally(() => prisma.$disconnect());
