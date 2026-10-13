/**
 * Grants a subscription discount to ONE business directly — a deal agreed by phone, with no code
 * for anyone to type.
 *
 * Usage (from backend/, against the environment holding the database):
 *   railway run npx tsx scripts/grant-coupon.ts --find אושר
 *   railway run npx tsx scripts/grant-coupon.ts --business <id> --price 87.90 --cycles 3 [--code DEAL-OSHER] --confirm
 *
 * Expressed as the price the owner was promised, not as a discount: "₪87.90 a month" is what was
 * said on the phone, and the arithmetic to the whole-shekel discount the billing job stores is
 * done here, once, and printed. Refuses a price that does not land on a whole-shekel discount,
 * because couponDiscountIls is an Int and a rounded discount would quietly change the promise.
 *
 * Without --confirm it prints what would change and stops. The workflow log is the audit trail.
 */

import { prisma } from "../src/lib/prisma.js";
import { PLAN_PRICES_ILS } from "../src/billing/payplusSubscription.js";
import { subscriptionChargeIls } from "../src/billing/subscriptionAmount.js";
import { fmtIls } from "../src/lib/money.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const SELECT = {
  id: true, name: true, email: true, subscriptionPlan: true, subscriptionStatus: true, billingCycle: true,
  nextBillingDate: true, loyaltyDiscountIls: true, couponCode: true, couponDiscountIls: true, couponCyclesRemaining: true,
  paymentProvider: true, invoiceProvider: true, subscriptionToken: true,
} as const;

function describe(b: {
  name: string; email: string; subscriptionPlan: string | null; subscriptionStatus: string; billingCycle: string;
  nextBillingDate: Date | null; loyaltyDiscountIls: number; couponCode: string | null; couponDiscountIls: number;
  couponCyclesRemaining: number | null; paymentProvider: string | null; invoiceProvider: string | null; subscriptionToken: string | null;
}): string {
  const coupon = b.couponDiscountIls > 0
    ? `coupon ${b.couponCode ?? "(no code)"} −₪${b.couponDiscountIls} × ${b.couponCyclesRemaining ?? "∞"}`
    : "no coupon";
  const charge = b.subscriptionPlan ? `next charge ₪${fmtIls(subscriptionChargeIls(b))}` : "no plan";
  return `${b.name} <${b.email}>\n      ${b.subscriptionPlan ?? "—"} / ${b.subscriptionStatus} / ${b.billingCycle} · card ${b.subscriptionToken ? "saved" : "missing"}` +
    `\n      ${coupon} · ${charge} · next ${b.nextBillingDate?.toISOString().slice(0, 10) ?? "—"}`;
}

async function main() {
  const find = arg("find");
  if (find) {
    const rows = await prisma.business.findMany({
      where: { OR: [{ name: { contains: find, mode: "insensitive" } }, { email: { contains: find, mode: "insensitive" } }] },
      select: SELECT,
      orderBy: { createdAt: "asc" },
    });
    if (rows.length === 0) console.log(`No business matches "${find}".`);
    for (const b of rows) console.log(`  ${b.id}  ${describe(b)}\n`);
    return;
  }

  const id = arg("business");
  const price = Number(arg("price"));
  const cycles = arg("cycles") === undefined ? null : Number(arg("cycles"));
  if (!id || !Number.isFinite(price)) throw new Error("Need --business <id> and --price <ILS per month>, or --find <text>.");
  if (cycles !== null && (!Number.isInteger(cycles) || cycles < 1)) throw new Error("--cycles must be a whole number ≥ 1 (omit for forever).");

  const b = await prisma.business.findUniqueOrThrow({ where: { id }, select: SELECT });
  const plan = b.subscriptionPlan ?? "standard";
  const listPrice = PLAN_PRICES_ILS[plan];
  if (!listPrice) throw new Error(`Unknown plan ${plan}`);
  const discount = Math.round((listPrice - price) * 100) / 100;
  if (discount <= 0) throw new Error(`₪${price} is not below the ${plan} price of ₪${fmtIls(listPrice)}.`);
  if (!Number.isInteger(discount)) {
    throw new Error(`₪${price} would need a discount of ₪${discount}, which is not a whole shekel. Closest prices: ₪${fmtIls(listPrice - Math.floor(discount))} or ₪${fmtIls(listPrice - Math.ceil(discount))}.`);
  }
  const code = arg("code") ?? `DEAL-${new Date().toISOString().slice(0, 10)}`;

  console.log(`Before:\n  ${describe(b)}\n`);
  const after = { ...b, couponCode: code, couponDiscountIls: discount, couponCyclesRemaining: cycles };
  console.log(`After:\n  ${describe(after)}\n`);
  console.log(`Plan ${plan} ₪${fmtIls(listPrice)} − ₪${discount} = ₪${fmtIls(listPrice - discount)} a month, for ${cycles ?? "every"} charge(s); then back to ₪${fmtIls(listPrice)}.`);
  if (b.couponDiscountIls > 0) console.log(`⚠ Replaces the existing coupon ${b.couponCode ?? ""} (−₪${b.couponDiscountIls} × ${b.couponCyclesRemaining ?? "∞"}).`);

  if (!has("confirm")) {
    console.log("\nNothing changed. Re-run with --confirm.");
    return;
  }
  await prisma.business.update({ where: { id }, data: { couponCode: code, couponDiscountIls: discount, couponCyclesRemaining: cycles } });
  console.log(`✔ Granted. The next ${cycles ?? "∞"} charge(s) will be ₪${fmtIls(subscriptionChargeIls(after))}.`);
}

main()
  .catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); })
  .finally(() => prisma.$disconnect());
