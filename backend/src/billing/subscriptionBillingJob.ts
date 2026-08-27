import { prisma } from "../lib/prisma.js";
import { couponDiscountForCharge, couponStateAfterCharge } from "./coupons.js";
import { decryptSecret } from "../lib/crypto.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";
import { sendAdminAlertEmail } from "../lib/email.js";
import {
  chargeSubscriptionToken,
  fetchCustomerUidForToken,
  PLAN_PRICES_ILS,
  BILLING_PERIOD_DAYS,
  LOYALTY_DISCOUNT_AFTER_CYCLES,
  LOYALTY_DISCOUNT_ILS,
  MANAGED_PAYMENT_SURCHARGE_ILS,
  MANAGED_INVOICE_SURCHARGE_ILS,
} from "./payplusSubscription.js";

const FRONTEND_URL = process.env.FRONTEND_URL?.split(",")[0]?.trim() ?? "https://torionline.com";

/** Best-effort WhatsApp notice to the owner — billing must never fail because a notification did. */
async function notifyOwner(business: {
  notificationPhone: string | null;
  whatsappPhoneNumberId: string | null;
  whatsappAccessToken: string | null;
}, text: string): Promise<void> {
  if (!business.notificationPhone || !business.whatsappPhoneNumberId || !business.whatsappAccessToken) return;
  try {
    const accessToken = decryptSecret(business.whatsappAccessToken);
    await sendWhatsAppMessage({ phoneNumberId: business.whatsappPhoneNumberId, accessToken, to: business.notificationPhone, text });
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
      subscriptionToken: { not: null },
      subscriptionPlan: { not: null },
      nextBillingDate: { lte: now },
    },
    select: {
      id: true, name: true, subscriptionToken: true, subscriptionCustomerUid: true, subscriptionPlan: true, billingCycle: true,
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

    const basePrice = PLAN_PRICES_ILS[business.subscriptionPlan!];
    if (!basePrice) {
      console.error(`[subscriptionBilling] Unknown plan "${business.subscriptionPlan}" for business ${business.id} — skipping`);
      continue;
    }
    const periodDays = BILLING_PERIOD_DAYS[business.billingCycle] ?? 30;
    const periodMultiplier = business.billingCycle === "annual" ? 10 : 1;
    const managedSurcharge =
      (business.paymentProvider === "tori_managed" ? MANAGED_PAYMENT_SURCHARGE_ILS : 0) +
      (business.invoiceProvider === "tori_managed" ? MANAGED_INVOICE_SURCHARGE_ILS : 0);
    const fullAmount = basePrice * periodMultiplier + managedSurcharge * periodMultiplier;
    // The coupon is a per-cycle discount, so an annual term gets it off each month charged — the
    // same arithmetic the checkout page quoted, which is the number the owner agreed to.
    const couponOff = couponDiscountForCharge(business) * periodMultiplier;
    // Floor of ₪1: PayPlus rejects a zero charge, and a discount that fully covers a plan is a
    // real thing to hand someone. Clamping here rather than refusing keeps them subscribed.
    const amountIls = Math.max(1, fullAmount - business.loyaltyDiscountIls - couponOff);

    const token = decryptSecret(business.subscriptionToken!);

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

    const result = await chargeSubscriptionToken(
      token,
      amountIls,
      `תורי — חיוב ${business.billingCycle === "annual" ? "שנתי" : "חודשי"} (${business.name})`,
      customerUid
    );

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
          ...(justEarnedDiscount ? { loyaltyDiscountIls: LOYALTY_DISCOUNT_ILS } : {}),
          // Counted down only on success. A failed attempt that consumed a discounted cycle would
          // quietly raise the price of the retry — the last thing a business with a declined card
          // needs, and impossible to explain afterwards.
          ...couponStateAfterCharge(business),
        },
      });
      console.log(`[subscriptionBilling] Charged ${business.id} (${business.name}) ₪${amountIls}`);

      if (justEarnedDiscount) {
        await notifyOwner(
          business,
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

      await notifyOwner(
        business,
        givingUp
          ? `⚠️ החיוב עבור תורי (₪${amountIls}) נכשל שוב והבוט נעצר. כדי להפעיל מחדש, עדכנו אמצעי תשלום: ${FRONTEND_URL}/dashboard/billing`
          : `⚠️ החיוב עבור תורי (₪${amountIls}) לא עבר. הבוט ממשיך לעבוד כרגיל — ננסה שוב בעוד ${retryInDays} ימים. אם תרצו, אפשר לעדכן אמצעי תשלום כבר עכשיו: ${FRONTEND_URL}/dashboard/billing`
      );
      // Only worth waking the operator when the account has actually stopped. The intermediate
      // retries are routine and would just train us to ignore the alert.
      if (givingUp) {
        sendAdminAlertEmail(
          `⚠️ חיוב נכשל — ${business.name}`,
          `<h2 style="color:#fff;margin-bottom:8px;">${business.name} עבר ל-past_due</h2><p style="color:#a1a1aa;">חיוב של ₪${amountIls} נכשל ${attempts} פעמים. השגיאה האחרונה: ${result.error}</p>`
        ).catch((err) => console.error("[subscriptionBilling] Churn-risk admin alert failed:", err));
      }
    }
  }
}
