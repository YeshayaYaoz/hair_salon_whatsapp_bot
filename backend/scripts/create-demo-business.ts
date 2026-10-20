/**
 * Creates the public demo business on Tori's shared line, or reports the one that exists.
 *
 * Usage: railway run npx tsx scripts/create-demo-business.ts [--confirm]
 *
 * Idempotent by email: run twice and the second run prints the same id. A salon, seeded through
 * applyTemplate exactly as an owner's onboarding click would seed it — services, opening hours,
 * tone, policy — so the demo shows the product as a new customer gets it, not a special build.
 *
 * Three choices, each deliberate:
 *   - active, not trial. A trial lapses and the shared-line routing then switches the demo off.
 *     No card and no billing date, so the billing job never tries to charge it.
 *   - no manager number. The shared line resolves a sender to the business whose verified manager
 *     number it is; a demo with the operator's phone would turn the operator into its owner, and
 *     "דמו" from that phone would open the manager tools instead of the demo.
 *   - no WhatsApp number of its own. That is what puts it on the shared line at all.
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { applyTemplate } from "../src/lib/applyTemplate.js";

const EMAIL = "demo@torionline.com";
const NAME = "מספרת הדמו של תורי";
const GREETING =
  "היי! 👋 כאן הבוט של מספרת הדמו. אפשר לקבוע אצלי תור, לשאול על מחירים ושעות, או לבטל ולהזיז. מה תרצו?";
const confirm = process.argv.includes("--confirm");

async function main() {
  const existing = await prisma.business.findUnique({
    where: { email: EMAIL },
    select: { id: true, name: true, subscriptionStatus: true, whatsappPhoneNumberId: true, notificationPhone: true, _count: { select: { services: true, hours: true } } },
  });
  if (existing) {
    console.log(`Exists: ${existing.id}  ${existing.name}`);
    console.log(`  status ${existing.subscriptionStatus} · own number ${existing.whatsappPhoneNumberId ? "YES (demo will be off)" : "no"} · manager ${existing.notificationPhone ?? "none"} · ${existing._count.services} services · ${existing._count.hours} days of hours`);
    console.log(`DEMO_BUSINESS_ID=${existing.id}`);
    return;
  }

  console.log(`Would create "${NAME}" <${EMAIL}>: salon template, active, no number, no manager phone.`);
  if (!confirm) {
    console.log("Nothing created. Re-run with --confirm.");
    return;
  }

  // Nobody logs in as the demo; the operator reaches it through impersonation in the admin page.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString("base64url"), 10);
  const business = await prisma.business.create({
    data: {
      name: NAME,
      email: EMAIL,
      passwordHash,
      emailVerifiedAt: new Date(),
      subscriptionStatus: "active",
      subscriptionPlan: "standard",
      botGreeting: GREETING,
    },
  });
  const seeded = await applyTemplate(business.id, "salon");
  // The template may switch deposits on; a demo must never send a stranger a real payment page.
  await prisma.business.update({ where: { id: business.id }, data: { depositEnabled: false } });
  console.log(`✔ Created ${business.id} — ${seeded.seededServices} services, ${seeded.seededHours} days of hours, presets: ${seeded.appliedPresets.join(", ") || "none"}`);
  console.log(`DEMO_BUSINESS_ID=${business.id}`);
}

main()
  .catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); })
  .finally(() => prisma.$disconnect());
