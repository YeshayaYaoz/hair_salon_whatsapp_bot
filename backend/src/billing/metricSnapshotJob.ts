import { prisma } from "../lib/prisma.js";
import { PLAN_PRICES_ILS, ANNUAL_MONTHS_CHARGED } from "./payplusSubscription.js";

/** Once-daily snapshot of fleet-wide MRR/subscription-status counts, so the super-admin panel can
 * chart a real trend instead of only ever showing today's point-in-time numbers. Upserts on the
 * UTC calendar date so re-running mid-day (e.g. after a deploy) just overwrites today's row rather
 * than creating duplicates. */
export async function runMetricSnapshotJob(): Promise<void> {
  const businesses = await prisma.business.findMany({
    select: { subscriptionStatus: true, subscriptionPlan: true, billingCycle: true },
  });

  let mrrIls = 0;
  let activeCount = 0;
  let trialCount = 0;
  let pastDueCount = 0;
  let canceledCount = 0;

  for (const b of businesses) {
    if (b.subscriptionStatus === "active") {
      activeCount++;
      if (b.subscriptionPlan) {
        const base = PLAN_PRICES_ILS[b.subscriptionPlan] ?? 0;
        mrrIls += b.billingCycle === "annual" ? (base * ANNUAL_MONTHS_CHARGED) / 12 : base;
      }
    } else if (b.subscriptionStatus === "trial") trialCount++;
    else if (b.subscriptionStatus === "past_due") pastDueCount++;
    else if (b.subscriptionStatus === "canceled") canceledCount++;
  }

  const today = new Date();
  const dateOnly = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  await prisma.businessMetricSnapshot.upsert({
    where: { date: dateOnly },
    create: { date: dateOnly, mrrIls: Math.round(mrrIls), activeCount, trialCount, pastDueCount, canceledCount },
    update: { mrrIls: Math.round(mrrIls), activeCount, trialCount, pastDueCount, canceledCount },
  });
}
