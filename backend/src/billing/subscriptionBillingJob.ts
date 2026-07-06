import { prisma } from "../lib/prisma.js";
import { decryptSecret } from "../lib/crypto.js";
import { chargeSubscriptionToken, PLAN_PRICES_ILS } from "./payplusSubscription.js";

const BILLING_PERIOD_DAYS = 30;

/** Nightly job: charges every business whose PayPlus subscription token is due today. Runs
 * alongside the other daily jobs (reminders/reviews/digest/retention) via runTrackedJob. */
export async function runSubscriptionBillingJob(): Promise<void> {
  const now = new Date();
  const due = await prisma.business.findMany({
    where: {
      subscriptionStatus: "active",
      subscriptionToken: { not: null },
      subscriptionPlan: { not: null },
      nextBillingDate: { lte: now },
    },
    select: { id: true, name: true, subscriptionToken: true, subscriptionPlan: true },
  });

  for (const business of due) {
    const amountIls = PLAN_PRICES_ILS[business.subscriptionPlan!];
    if (!amountIls) {
      console.error(`[subscriptionBilling] Unknown plan "${business.subscriptionPlan}" for business ${business.id} — skipping`);
      continue;
    }

    const token = decryptSecret(business.subscriptionToken!);
    const result = await chargeSubscriptionToken(token, amountIls, `תורי — חיוב חודשי (${business.name})`);

    if (result.success) {
      await prisma.business.update({
        where: { id: business.id },
        data: {
          nextBillingDate: new Date(now.getTime() + BILLING_PERIOD_DAYS * 24 * 60 * 60 * 1000),
          lastBillingAttemptAt: now,
        },
      });
      console.log(`[subscriptionBilling] Charged ${business.id} (${business.name}) ₪${amountIls}`);
    } else {
      // One failed charge doesn't cancel the account outright — mark past_due so
      // requireActiveSubscription blocks access until the owner updates their payment method.
      await prisma.business.update({
        where: { id: business.id },
        data: { subscriptionStatus: "past_due", lastBillingAttemptAt: now },
      });
      console.error(`[subscriptionBilling] Charge failed for ${business.id} (${business.name}): ${result.error}`);
    }
  }
}
