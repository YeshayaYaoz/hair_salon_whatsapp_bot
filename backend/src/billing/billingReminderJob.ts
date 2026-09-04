import { prisma } from "../lib/prisma.js";
import { notifyOwner } from "../lib/ownerNotify.js";
import { subscriptionChargeIls } from "./subscriptionAmount.js";
import { fmtIls } from "../lib/money.js";

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const WINDOW_MS = 60 * 60 * 1000; // 1-hour window around the "2 days before" mark, matches the hourly job cadence

/** Hourly job: sends a heads-up WhatsApp message ~2 days before a business's next PayPlus charge,
 * so a failed/declined card is never a surprise — the #1 driver of avoidable SaaS churn. */
export async function runBillingReminderJob(): Promise<void> {
  const now = new Date();
  const targetFrom = new Date(now.getTime() + TWO_DAYS_MS - WINDOW_MS / 2);
  const targetTo = new Date(now.getTime() + TWO_DAYS_MS + WINDOW_MS / 2);

  const upcoming = await prisma.business.findMany({
    where: {
      subscriptionStatus: "active",
      subscriptionToken: { not: null },
      subscriptionPlan: { not: null },
      nextBillingDate: { gte: targetFrom, lte: targetTo },
      notificationPhone: { not: null },
      whatsappPhoneNumberId: { not: null },
      whatsappAccessToken: { not: null },
    },
    select: {
      id: true, name: true, subscriptionPlan: true, scheduledPlan: true, billingCycle: true, loyaltyDiscountIls: true,
      // Needed by subscriptionChargeIls — without these the reminder quotes a different amount
      // from the one the nightly job charges.
      couponDiscountIls: true, couponCyclesRemaining: true, paymentProvider: true, invoiceProvider: true,
      lastBillingReminderSentAt: true, nextBillingDate: true,
      notificationPhone: true, whatsappPhoneNumberId: true, whatsappAccessToken: true,
    },
  });

  for (const business of upcoming) {
    // Guard against duplicates: skip if we already sent one in the last 3 days (this job runs
    // hourly, and the target window is 1 hour wide, so a duplicate would only happen on retry).
    if (business.lastBillingReminderSentAt && now.getTime() - business.lastBillingReminderSentAt.getTime() < 3 * 24 * 60 * 60 * 1000) {
      continue;
    }

    // The same function the nightly charge uses, AND the same plan it will use. This used to be a
    // second copy that left out the managed-account surcharges and the coupon, so the figure
    // announced two days ahead was not the figure taken off the card. A scheduled downgrade is the
    // same failure wearing different clothes: the charge two days from now opens the new plan's
    // period at the new plan's price, so quoting the outgoing tier would overstate it — to someone
    // whose last action was asking to pay less.
    const amountIls = subscriptionChargeIls({
      ...business,
      subscriptionPlan: business.scheduledPlan ?? business.subscriptionPlan,
    });
    if (amountIls === null) continue;

    const text = `היי! תזכורת קלה: מחרתיים יתבצע החיוב ה${business.billingCycle === "annual" ? "שנתי" : "חודשי"} עבור תורי על סך ₪${fmtIls(amountIls)}. תודה שאתם איתנו! 🙏`;

    try {
      // Through the shared owner path: a bare free-form send is accepted by Meta and dropped when
      // the owner's 24-hour window is shut, and this is the notice whose whole purpose is to reach
      // someone before money leaves their account.
      if (!(await notifyOwner(business.id, text))) {
        console.error(`[billingReminder] Could not deliver pre-charge notice to business ${business.id}`);
        continue;
      }
      await prisma.business.update({ where: { id: business.id }, data: { lastBillingReminderSentAt: now } });
      console.log(`[billingReminder] Sent pre-charge notice to business ${business.id}`);
    } catch (err) {
      console.error(`[billingReminder] Failed for business ${business.id}:`, err);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}
