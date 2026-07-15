import { prisma } from "../lib/prisma.js";
import { decryptSecret } from "../lib/crypto.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";
import { sendAdminAlertEmail } from "../lib/email.js";
import {
  chargeSubscriptionToken,
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
      id: true, name: true, subscriptionToken: true, subscriptionPlan: true, billingCycle: true,
      billingCyclesCompleted: true, loyaltyDiscountIls: true, paymentProvider: true, invoiceProvider: true,
      notificationPhone: true, whatsappPhoneNumberId: true, whatsappAccessToken: true,
    },
  });

  for (const business of due) {
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
    const amountIls = Math.max(0, fullAmount - business.loyaltyDiscountIls);

    const token = decryptSecret(business.subscriptionToken!);
    const result = await chargeSubscriptionToken(token, amountIls, `תורי — חיוב ${business.billingCycle === "annual" ? "שנתי" : "חודשי"} (${business.name})`);

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
          messagesUsedThisCycle: 0, // new cycle paid for — reset the plan's message quota
          ...(justEarnedDiscount ? { loyaltyDiscountIls: LOYALTY_DISCOUNT_ILS } : {}),
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
      // One failed charge doesn't cancel the account outright — mark past_due so
      // requireActiveSubscription blocks access until the owner updates their payment method.
      await prisma.business.update({
        where: { id: business.id },
        data: { subscriptionStatus: "past_due", lastBillingAttemptAt: now },
      });
      console.error(`[subscriptionBilling] Charge failed for ${business.id} (${business.name}): ${result.error}`);

      await notifyOwner(
        business,
        `⚠️ החיוב החודשי עבור תורי (₪${amountIls}) נכשל. כדי למנוע עצירת הבוט, אנא עדכן/י את אמצעי התשלום בדשבורד: ${FRONTEND_URL}/dashboard/billing`
      );
      sendAdminAlertEmail(
        `⚠️ חיוב נכשל — ${business.name}`,
        `<h2 style="color:#fff;margin-bottom:8px;">${business.name} עבר ל-past_due</h2><p style="color:#a1a1aa;">חיוב של ₪${amountIls} נכשל: ${result.error}</p>`
      ).catch((err) => console.error("[subscriptionBilling] Churn-risk admin alert failed:", err));
    }
  }
}
