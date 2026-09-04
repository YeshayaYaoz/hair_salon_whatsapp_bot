import { prisma } from "../lib/prisma.js";
import { couponStateAfterCharge } from "./coupons.js";
import { decryptSecret } from "../lib/crypto.js";
import { notifyOwner } from "../lib/ownerNotify.js";
import { sendAdminAlertEmail } from "../lib/email.js";
import { subscriptionChargeIls } from "./subscriptionAmount.js";
import { fmtIls } from "../lib/money.js";
import {
  chargeSubscriptionToken,
  fetchCustomerUidForToken,
  BILLING_PERIOD_DAYS,
  LOYALTY_DISCOUNT_AFTER_CYCLES,
  LOYALTY_DISCOUNT_ILS,
} from "./payplusSubscription.js";

const FRONTEND_URL = process.env.FRONTEND_URL?.split(",")[0]?.trim() ?? "https://torionline.com";

/**
 * Best-effort notice to the owner — billing must never fail because a notification did.
 *
 * Delegates to lib/ownerNotify rather than sending free-form here. This used to be a bare
 * sendWhatsAppMessage, which Meta accepts with a 200 and then drops when the owner's 24-hour
 * window is shut — so the one message that must arrive, "we are about to charge your card", was
 * the one most likely to be silently lost, since an owner has no reason to have messaged their own
 * bot that day. The shared path checks the window, uses the approved template, then email.
 */
async function notifyOwnerOfBilling(businessId: string, text: string): Promise<void> {
  try {
    await notifyOwner(businessId, text);
  } catch (err) {
    console.error("[subscriptionBilling] Owner notification failed (non-fatal):", err);
  }
}

/**
 * Days to wait before retrying after each consecutive failed charge.
 *
 * A single decline used to flip the business straight to past_due, which blocks the bot that same
 * night — so a card with a temporary hold on it cost a paying salon their booking line. These are
 * the gaps between attempts: first failure retries two days later, second another two, and only a
 * third failure gives up. Every entry must be at least a day, or the claim guard below (which
 * allows one attempt per business per day) would silently swallow the retry.
 */
const RETRY_AFTER_DAYS = [2, 2];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight boundary used by the claim guard — one charge attempt per business per calendar day. */
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Claims a business for charging, atomically, before any money moves.
 *
 * Without this, `nextBillingDate` only advanced after a successful charge — so if the process died
 * between PayPlus taking the money and our update landing, the next run charged the same business
 * again. Railway redeploys make that a real scenario, not a thought experiment, and a double charge
 * is the single worst bug this file could have.
 *
 * The conditional updateMany is the lock: only one caller can transition a row whose
 * billingClaimedAt is null or older than today, so a concurrent run (or a restarted one) sees zero
 * rows affected and skips. Returns false when the claim was lost.
 */
async function claimForCharging(businessId: string, now: Date): Promise<boolean> {
  const { count } = await prisma.business.updateMany({
    where: {
      id: businessId,
      OR: [{ billingClaimedAt: null }, { billingClaimedAt: { lt: startOfDay(now) } }],
    },
    data: { billingClaimedAt: now },
  });
  return count === 1;
}

/** Nightly job: charges every business whose PayPlus subscription token is due today. Runs
 * alongside the other daily jobs (reminders/reviews/digest/retention) via runTrackedJob. */
export async function runSubscriptionBillingJob(): Promise<void> {
  const now = new Date();
  const due = await prisma.business.findMany({
    where: {
      subscriptionStatus: "active",
      subscriptionPlan: { not: null },
      nextBillingDate: { lte: now },
      // Deliberately NOT filtered on subscriptionToken. It used to be, and that made a whole class
      // of unbillable subscription invisible: active, on a plan, due weeks ago, no saved card, and
      // never selected here — so no charge, no failure, no dunning, no notice to anyone. A business
      // can reach that state legitimately (activated by hand, or a checkout whose callback carried
      // no token and whose Token/List recovery came up empty). Money was owed and nobody was told.
      // Now they are selected and run through the same dunning ladder as a declined card, which is
      // what this is: a charge that cannot be collected.
    },
    select: {
      id: true, name: true, subscriptionToken: true, subscriptionCustomerUid: true, subscriptionPlan: true, scheduledPlan: true, billingCycle: true,
      billingCyclesCompleted: true, loyaltyDiscountIls: true, paymentProvider: true, invoiceProvider: true,
      couponDiscountIls: true, couponCyclesRemaining: true,
      billingFailedAttempts: true,
      notificationPhone: true, whatsappPhoneNumberId: true, whatsappAccessToken: true,
    },
  });

  for (const business of due) {
    // Claimed before the charge, never after — see claimForCharging.
    if (!(await claimForCharging(business.id, now))) {
      console.warn(`[subscriptionBilling] ${business.id} already claimed today — skipping to avoid a double charge`);
      continue;
    }

    const periodDays = BILLING_PERIOD_DAYS[business.billingCycle] ?? 30;

    // A downgrade the owner scheduled takes effect now, because "now" is the start of the period
    // it applies to. Resolved BEFORE the amount is worked out, not after: the charge opening a
    // Standard period has to be Standard's price, and computing it from the outgoing plan would
    // bill a full extra period of the tier they asked to leave.
    const effectivePlan = business.scheduledPlan ?? business.subscriptionPlan;
    const planChanging = !!business.scheduledPlan && business.scheduledPlan !== business.subscriptionPlan;

    // Shared with the pre-charge reminder, which used to compute its own version and quote a
    // different number two days beforehand. See subscriptionAmount.ts — which also applies the
    // coupon and the annual multiplier, so nothing here may recompute either. A second copy of
    // that arithmetic sat right below this line, unused, for exactly as long as it took someone
    // to notice; the next person to touch it would have wired it in and double-counted.
    const amountIls = subscriptionChargeIls({ ...business, subscriptionPlan: effectivePlan });
    if (amountIls === null) {
      console.error(`[subscriptionBilling] Unknown plan "${business.subscriptionPlan}" for business ${business.id} — skipping`);
      continue;
    }

    const token = business.subscriptionToken ? decryptSecret(business.subscriptionToken) : null;

    let result: { success: boolean; error?: string };
    if (!token) {
      // Nothing to charge with. Reported as a failure rather than skipped, so it travels down the
      // dunning path below and the owner actually hears about it.
      result = { success: false, error: "no-saved-card" };
      console.error(
        `[subscriptionBilling] ${business.id} (${business.name}) is due ₪${fmtIls(amountIls)} but has no saved card — dunning instead of charging`
      );
    } else {
      // A card stored before customer_uid was persisted next to it leaves the row holding half of
      // what Transactions/Charge requires. Recover the missing half from the token rather than
      // failing the renewal and asking a paying customer to enter their card again — and store it,
      // so this costs one extra request per stranded business exactly once.
      let customerUid = business.subscriptionCustomerUid ?? undefined;
      if (!customerUid) {
        customerUid = await fetchCustomerUidForToken(token);
        if (customerUid) {
          await prisma.business.update({ where: { id: business.id }, data: { subscriptionCustomerUid: customerUid } });
          console.log(`[subscriptionBilling] Recovered customer_uid for business ${business.id} from its saved token`);
        } else {
          console.warn(`[subscriptionBilling] Business ${business.id} has a token but no customer_uid, and Token/View could not supply one`);
        }
      }

      result = await chargeSubscriptionToken(
        token,
        amountIls,
        `תורי — חיוב ${business.billingCycle === "annual" ? "שנתי" : "חודשי"} (${business.name})`,
        customerUid
      );
    }

    if (result.success) {
      // Loyalty discount: only tracked for monthly billing — award it once tenure crosses the
      // threshold, and only ever apply it once (loyaltyDiscountIls stays at LOYALTY_DISCOUNT_ILS
      // afterwards, doesn't keep compounding on every subsequent charge).
      const cyclesCompleted = business.billingCyclesCompleted + 1;
      const justEarnedDiscount =
        business.billingCycle === "monthly" &&
        business.loyaltyDiscountIls === 0 &&
        cyclesCompleted >= LOYALTY_DISCOUNT_AFTER_CYCLES;

      await prisma.business.update({
        where: { id: business.id },
        data: {
          nextBillingDate: new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000),
          lastBillingAttemptAt: now,
          billingCyclesCompleted: cyclesCompleted,
          billingFailedAttempts: 0, // paid — any dunning run in progress is over
          messagesUsedThisCycle: 0, // new cycle paid for — reset the plan's message quota
          // Applied only alongside a charge that actually collected. On a decline the business
          // keeps the plan it has and the instruction stays armed for the retry — dropping them a
          // tier because a card failed would take away service they are still paid up for.
          ...(planChanging ? { subscriptionPlan: effectivePlan, scheduledPlan: null } : {}),
          ...(justEarnedDiscount ? { loyaltyDiscountIls: LOYALTY_DISCOUNT_ILS } : {}),
          // Counted down only on success. A failed attempt that consumed a discounted cycle would
          // quietly raise the price of the retry — the last thing a business with a declined card
          // needs, and impossible to explain afterwards.
          ...couponStateAfterCharge(business),
        },
      });
      console.log(`[subscriptionBilling] Charged ${business.id} (${business.name}) ₪${fmtIls(amountIls)}`);

      if (planChanging) {
        console.log(`[subscriptionBilling] ${business.id} moved ${business.subscriptionPlan} → ${effectivePlan} as scheduled`);
        // Told at the moment it happens rather than when it was requested, which may have been a
        // year earlier on an annual term. The quota changes today and so does the price.
        await notifyOwnerOfBilling(
          business.id,
          `המסלול שלכם בתורי עודכן ל-${effectivePlan} כפי שביקשתם, ומהיום זה המחיר שתשלמו. הפרטים בדשבורד: ${FRONTEND_URL}/dashboard/billing`
        );
      }

      if (justEarnedDiscount) {
        await notifyOwnerOfBilling(
          business.id,
          `🎁 הרווחת! בתור הערכה על ${LOYALTY_DISCOUNT_AFTER_CYCLES} חודשים איתנו, מהחיוב הבא תשלמו ₪${LOYALTY_DISCOUNT_ILS} פחות על תורי כל חודש. תודה שאתם איתנו!`
        );
      }
    } else {
      // Dunning: retry over several days before pulling access. Only the final failure sets
      // past_due (which is what requireActiveSubscription blocks on), so a card with a temporary
      // hold no longer takes a paying salon's bot offline the same night.
      const attempts = business.billingFailedAttempts + 1;
      const retryInDays = RETRY_AFTER_DAYS[attempts - 1];
      const givingUp = retryInDays === undefined;

      await prisma.business.update({
        where: { id: business.id },
        data: {
          billingFailedAttempts: attempts,
          lastBillingAttemptAt: now,
          ...(givingUp
            ? { subscriptionStatus: "past_due" }
            : // Re-armed for the retry day. Left as-is on the final failure: past_due is terminal
              // until the owner acts, and a due date in the past would keep re-charging them.
              { nextBillingDate: new Date(now.getTime() + retryInDays * DAY_MS) }),
        },
      });
      console.error(
        `[subscriptionBilling] Charge failed for ${business.id} (${business.name}), attempt ${attempts}: ${result.error}` +
          (givingUp ? " — giving up, marked past_due" : ` — retrying in ${retryInDays} days`)
      );

      // "The charge didn't go through" would be misleading when there was never a card to charge —
      // the owner would go looking at their bank for a decline that never happened. Say what is
      // actually missing, and ask for the one thing that fixes it.
      const noCard = !token;
      await notifyOwnerOfBilling(
        business.id,
        noCard
          ? givingUp
            ? `⚠️ אין אמצעי תשלום שמור לתורי, והחיוב של ₪${fmtIls(amountIls)} לא נגבה — הבוט נעצר. להוספת כרטיס והפעלה מחדש: ${FRONTEND_URL}/dashboard/billing`
            : `⚠️ אין אמצעי תשלום שמור לתורי, כך שהחיוב של ₪${fmtIls(amountIls)} לא נגבה. הבוט ממשיך לעבוד כרגיל — נבדוק שוב בעוד ${retryInDays} ימים. להוספת כרטיס: ${FRONTEND_URL}/dashboard/billing`
          : givingUp
            ? `⚠️ החיוב עבור תורי (₪${fmtIls(amountIls)}) נכשל שוב והבוט נעצר. כדי להפעיל מחדש, עדכנו אמצעי תשלום: ${FRONTEND_URL}/dashboard/billing`
            : `⚠️ החיוב עבור תורי (₪${fmtIls(amountIls)}) לא עבר. הבוט ממשיך לעבוד כרגיל — ננסה שוב בעוד ${retryInDays} ימים. אם תרצו, אפשר לעדכן אמצעי תשלום כבר עכשיו: ${FRONTEND_URL}/dashboard/billing`
      );
      // Only worth waking the operator when the account has actually stopped. The intermediate
      // retries are routine and would just train us to ignore the alert.
      if (givingUp) {
        sendAdminAlertEmail(
          `⚠️ חיוב נכשל — ${business.name}`,
          `<h2 style="color:#fff;margin-bottom:8px;">${business.name} עבר ל-past_due</h2><p style="color:#a1a1aa;">חיוב של ₪${fmtIls(amountIls)} נכשל ${attempts} פעמים. השגיאה האחרונה: ${result.error}</p>`
        ).catch((err) => console.error("[subscriptionBilling] Churn-risk admin alert failed:", err));
      }
    }
  }
}
