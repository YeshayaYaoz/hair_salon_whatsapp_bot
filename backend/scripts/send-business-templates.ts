/**
 * Sends every APPROVED template on one business's own WABA to one number, so a human can look at
 * what the templates actually render as on a handset.
 *
 * Usage (from backend/, against the environment holding the credentials):
 *   railway run npx tsx scripts/send-business-templates.ts --business <id> [--to 0501234567] --confirm
 *
 * Why the business's own credentials rather than send-test-template.ts: templates live at the WABA
 * level, and each business connects its own. Tori's outreach number cannot send a salon's
 * tori_appointment_reminder_2 — it does not hold it (132001). Only the business's own phone number
 * id and token can, which means decrypting that business's stored token.
 *
 * The parameters come from Meta's own stored example values for each template, not from a list
 * kept here. A template's variable count is whatever Meta approved, and passing the wrong number
 * is rejected — reading the count and the sample text off the approved components is the only way
 * for one script to cover templates it does not know the shape of. It also makes the received
 * message identical to what a reviewer saw, which is the point of looking at it.
 */

import { prisma } from "../src/lib/prisma.js";
import { decryptSecret } from "../src/lib/crypto.js";
import { normalizeOwnerPhone } from "../src/lib/phone.js";
import { sendWhatsAppTemplate } from "../src/webhook/whatsappClient.js";

const GRAPH = "https://graph.facebook.com/v21.0";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface TemplateComponent {
  type: string;
  text?: string;
  example?: { body_text?: string[][] };
}

interface MetaTemplate {
  name: string;
  status: string;
  category: string;
  language: string;
  components?: TemplateComponent[];
}

/**
 * The sample values Meta holds for this template, in order.
 *
 * A template with no variables has no example block and needs an empty array — not one blank
 * string, which Meta rejects as a parameter the body has no slot for.
 */
function exampleParams(t: MetaTemplate): string[] {
  const body = t.components?.find((c) => c.type === "BODY");
  return body?.example?.body_text?.[0] ?? [];
}

function bodyText(t: MetaTemplate): string {
  return t.components?.find((c) => c.type === "BODY")?.text ?? "";
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
      businessType: true,
      notificationPhone: true,
      whatsappPhoneNumberId: true,
      whatsappAccessToken: true,
      whatsappWabaId: true,
    },
  });
  if (!business) {
    console.error(`No business ${businessId}`);
    process.exit(1);
  }
  if (!business.whatsappPhoneNumberId || !business.whatsappAccessToken || !business.whatsappWabaId) {
    console.error(`${business.name} has no connected WhatsApp number — nothing can be sent from it.`);
    process.exit(1);
  }

  const to = normalizeOwnerPhone(arg("to") ?? business.notificationPhone ?? "");
  if (!to) {
    console.error("--to needs a number that can be qualified, and the business has no usable notificationPhone");
    process.exit(1);
  }

  const accessToken = decryptSecret(business.whatsappAccessToken);
  const res = await fetch(
    `${GRAPH}/${business.whatsappWabaId}/message_templates?fields=name,status,category,language,components&limit=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const json = (await res.json()) as { data?: MetaTemplate[]; error?: { message: string } };
  if (json.error) {
    console.error(`Cannot list templates: ${json.error.message}`);
    process.exit(1);
  }

  const approved = (json.data ?? []).filter((t) => t.status === "APPROVED");
  const pending = (json.data ?? []).filter((t) => t.status !== "APPROVED");

  console.log(`${business.name} — WABA ${business.whatsappWabaId} — sending to ${to}`);
  console.log("");
  for (const t of approved) {
    const params = exampleParams(t);
    console.log(`  ${t.name} [${t.language}] ${t.category} — ${params.length} param(s)`);
    console.log(`    ${bodyText(t).replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? `{{${n}}}`)}`);
  }
  if (pending.length) {
    console.log("");
    console.log("Not sent — not APPROVED yet:");
    for (const t of pending) console.log(`  ${t.name} — ${t.status}`);
  }
  console.log("");

  // Sending costs money per conversation and lands on a real handset, so the listing above is the
  // whole run unless --confirm says otherwise.
  if (!process.argv.includes("--confirm")) {
    console.log("Dry run. Re-run with --confirm to actually send.");
    return;
  }

  let sent = 0;
  for (const t of approved) {
    try {
      await sendWhatsAppTemplate({
        phoneNumberId: business.whatsappPhoneNumberId,
        accessToken,
        to,
        templateName: t.name,
        languageCode: t.language,
        bodyParams: exampleParams(t),
      });
      console.log(`✔ ${t.name} — accepted by Meta`);
      sent++;
    } catch (err) {
      // Keep going. One template refused (wrong param count, category block) says nothing about
      // the rest, and stopping here would hide which of the others would have arrived.
      console.log(`✖ ${t.name} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log("");
  console.log(`${sent}/${approved.length} accepted. Acceptance is not delivery — the handset is the answer.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
