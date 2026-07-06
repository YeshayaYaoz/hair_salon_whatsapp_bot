import { prisma } from "../lib/prisma.js";
import { decryptSecret } from "../lib/crypto.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";
import { PLAN_PRICES_ILS } from "./payplusSubscription.js";

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
      id: true, name: true, subscriptionPlan: true, billingCycle: true, loyaltyDiscountIls: true,
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

    const basePrice = PLAN_PRICES_ILS[business.subscriptionPlan!];
    if (!basePrice) continue;
    const fullAmount = business.billingCycle === "annual" ? basePrice * 10 : basePrice;
    const amountIls = Math.max(0, fullAmount - business.loyaltyDiscountIls);

    const text = `היי! תזכורת קלה: מחרתיים יתבצע החיוב ה${business.billingCycle === "annual" ? "שנתי" : "חודשי"} עבור תורי על סך ₪${amountIls}. תודה שאתם איתנו! 🙏`;

    try {
      const accessToken = decryptSecret(business.whatsappAccessToken!);
      await sendWhatsAppMessage({ phoneNumberId: business.whatsappPhoneNumberId!, accessToken, to: business.notificationPhone!, text });
      await prisma.business.update({ where: { id: business.id }, data: { lastBillingReminderSentAt: now } });
      console.log(`[billingReminder] Sent pre-charge notice to business ${business.id}`);
    } catch (err) {
      console.error(`[billingReminder] Failed for business ${business.id}:`, err);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}
