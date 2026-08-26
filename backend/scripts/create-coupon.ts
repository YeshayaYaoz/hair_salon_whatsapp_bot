/**
 * Creates or inspects a discount code for Tori's OWN subscriptions.
 *
 * Usage (from backend/, against the environment holding the database):
 *   railway run npx tsx scripts/create-coupon.ts --list
 *   railway run npx tsx scripts/create-coupon.ts --code LAUNCH50 --percent 50 --cycles 3 --max 20
 *   railway run npx tsx scripts/create-coupon.ts --code SETUP100 --fixed 100 --cycles 1
 *
 * The dashboard has an operator-only API for the same thing; this exists because creating the
 * FIRST code needs to happen before anyone can use a screen to do it, and because a code is a
 * standing offer of money — running it here leaves a record in the workflow log of exactly what
 * was created and when.
 *
 * Idempotent by refusal, not by overwrite: a code that already exists is printed rather than
 * silently redefined. Changing what an existing code is worth would change it for everyone who
 * has been handed it on a flyer.
 */

import { prisma } from "../src/lib/prisma.js";
import { PLAN_PRICES_ILS } from "../src/billing/payplusSubscription.js";
import { discountFor, normalizeCode } from "../src/billing/coupons.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function describe(c: {
  code: string;
  discountType: string;
  discountValue: number;
  durationCycles: number | null;
  maxRedemptions: number | null;
  redeemedCount: number;
  expiresAt: Date | null;
  active: boolean;
  allowedPlans: string[];
  note: string | null;
}): string {
  const off = c.discountType === "percent" ? `${c.discountValue}%` : `₪${c.discountValue}`;
  const duration =
    c.durationCycles === null ? "forever" : c.durationCycles === 1 ? "first cycle only" : `${c.durationCycles} cycles`;
  const uses = c.maxRedemptions === null ? `${c.redeemedCount} used, unlimited` : `${c.redeemedCount}/${c.maxRedemptions} used`;
  // What it is actually worth per plan, because "50%" is not a number anyone can act on until it
  // is resolved against a price.
  const worth = Object.keys(PLAN_PRICES_ILS)
    .map((plan) => `${plan} −₪${discountFor(c, plan)}`)
    .join(", ");
  return [
    `${c.code}${c.active ? "" : "  (INACTIVE)"}`,
    `    ${off} off, ${duration} · ${uses}`,
    `    worth: ${worth}`,
    `    plans: ${c.allowedPlans.length ? c.allowedPlans.join(", ") : "all"}`,
    `    expires: ${c.expiresAt ? c.expiresAt.toISOString().slice(0, 10) : "never"}`,
    ...(c.note ? [`    note: ${c.note}`] : []),
  ].join("\n");
}

async function main() {
  if (has("list") || !arg("code")) {
    const rows = await prisma.coupon.findMany({
      orderBy: { createdAt: "desc" },
      include: { redemptions: { select: { business: { select: { name: true } }, redeemedAt: true } } },
    });
    if (rows.length === 0) {
      console.log("No coupons yet. Create one with --code X --percent N (or --fixed N).");
      return;
    }
    console.log(`${rows.length} coupon(s):\n`);
    for (const r of rows) {
      console.log(describe(r));
      for (const red of r.redemptions) {
        console.log(`      redeemed by ${red.business.name} on ${red.redeemedAt.toISOString().slice(0, 10)}`);
      }
      console.log("");
    }
    return;
  }

  const code = normalizeCode(arg("code")!);
  const percent = arg("percent");
  const fixed = arg("fixed");
  if (!percent && !fixed) throw new Error("Give either --percent <n> or --fixed <shekels>.");
  if (percent && fixed) throw new Error("Give --percent or --fixed, not both.");

  const discountType = percent ? "percent" : "fixed";
  const discountValue = Number(percent ?? fixed);
  if (!Number.isInteger(discountValue) || discountValue <= 0) throw new Error("The discount must be a positive whole number.");
  if (discountType === "percent" && discountValue > 100) throw new Error("A percentage discount cannot exceed 100.");

  const existing = await prisma.coupon.findUnique({ where: { code } });
  if (existing) {
    // Refused rather than updated: this code may already be printed on something.
    console.log(`${code} already exists — nothing changed.\n`);
    console.log(describe(existing));
    return;
  }

  // Absent means "no limit" for both of these, which is why they are null rather than 0 — a 0 cap
  // would be a coupon nobody can ever use.
  const cyclesArg = arg("cycles");
  const maxArg = arg("max");
  const expiresArg = arg("expires"); // YYYY-MM-DD

  const coupon = await prisma.coupon.create({
    data: {
      code,
      discountType,
      discountValue,
      durationCycles: cyclesArg ? Number(cyclesArg) : null,
      maxRedemptions: maxArg ? Number(maxArg) : null,
      // End of that day, so a code "valid until the 31st" works all through the 31st.
      expiresAt: expiresArg ? new Date(`${expiresArg}T23:59:59Z`) : null,
      allowedPlans: arg("plans") ? arg("plans")!.split(",").map((p) => p.trim()) : [],
      note: arg("note") ?? null,
    },
  });

  console.log("Created:\n");
  console.log(describe(coupon));
  console.log("\nBusinesses enter it on the dashboard's subscription page, in the coupon field.");
}

main()
  .catch((err) => {
    console.error("✖", (err as Error).message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
