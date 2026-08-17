/**
 * Prints, per business, which WhatsApp line Tori actually sends through.
 *
 * Usage (from backend/):
 *   railway run npx tsx scripts/whatsapp-wiring.ts
 *
 * The WABA listing and this table answer different questions, and confusing them is how a number
 * gets called abandoned while a customer is using it: Meta's listing says what is attached to *one*
 * WABA, and a number sitting there PENDING/NOT_VERIFIED looks abandoned. But a business can be
 * live on a different WABA, or on the WhatsApp Business *app*, which is not in the Graph API at all.
 * This table is what our own sending code reads, so it is the one that says what is in service.
 *
 * Read-only. Tokens are reported as present/absent, never printed.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const businesses = await prisma.business.findMany({
    select: {
      id: true,
      name: true,
      whatsappPhoneNumberId: true,
      whatsappWabaId: true,
      whatsappAccessToken: true,
      whatsappTokenValid: true,
      whatsappRegisteredAt: true,
      voicePhoneNumber: true,
    },
    orderBy: { name: "asc" },
  });

  console.log(`${businesses.length} business(es):\n`);
  for (const b of businesses) {
    console.log(`${b.name}  (id ${b.id})`);
    console.log(`    whatsapp phone number id: ${b.whatsappPhoneNumberId ?? "— none —"}`);
    console.log(`    whatsapp WABA id:         ${b.whatsappWabaId ?? "— none —"}`);
    console.log(`    access token:             ${b.whatsappAccessToken ? "set" : "— none —"}${b.whatsappTokenValid ? "" : " (marked INVALID)"}`);
    console.log(`    registered on Cloud API:  ${b.whatsappRegisteredAt?.toISOString() ?? "never"}`);
    console.log(`    voice number:             ${b.voicePhoneNumber ?? "— none —"}`);
    console.log("");
  }
}

main()
  .catch((err) => {
    console.error("✖", (err as Error).message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
