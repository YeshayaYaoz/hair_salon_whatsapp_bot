"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SkeletonBlock } from "../../lib/Skeleton";

const STATUS_COLORS: Record<string, string> = {
  trial: "bg-amber-50 text-amber-700 border-amber-200",
  active: "bg-green-50 text-green-700 border-green-200",
  past_due: "bg-red-50 text-red-600 border-red-200",
  canceled: "bg-gray-100 text-gray-600 border-gray-200",
};

type PlanKey = "standard" | "premium" | "ultra";
const PLANS: PlanKey[] = ["standard", "premium", "ultra"];
const PLAN_LABEL: Record<PlanKey, string> = { standard: "Standard", premium: "Premium", ultra: "Ultra" };
const PLAN_PRICES: Record<PlanKey, number> = { standard: 189, premium: 449, ultra: 849 };
// Must match ANNUAL_MONTHS_CHARGED in backend/src/billing/payplusSubscription.ts — the annual term
// charges this many months for 12 months of service.
const ANNUAL_MONTHS_CHARGED = 10;

// Must match MESSAGE_QUOTA_BY_PLAN in backend/src/lib/wallet.ts — display-only, not authoritative.
const MESSAGE_QUOTA_BY_PLAN: Record<PlanKey, number> = { standard: 300, premium: 1000, ultra: 3000 };

// Features shared by both plans — everything below is what actually differs, so the comparison
// is honest about what a Premium upgrade buys today rather than padding the list.
const SHARED_FEATURES_HE = [
  "בוט WhatsApp פעיל 24/7",
  "קביעת תורים ותזכורות אוטומטיות",
  "סנכרון מלא עם Google Calendar",
  "דשבורד ניהול ואנליטיקס",
  "תמיכה טכנית ללא הגבלה",
];
const SHARED_FEATURES_EN = [
  "24/7 active WhatsApp bot",
  "Automatic booking & reminders",
  "Full Google Calendar sync",
  "Management dashboard & analytics",
  "Unlimited technical support",
];

const AFTER_HOURS_CAPTURE = 0.15; // share of bookings recovered by answering 24/7
const MINUTES_SAVED_PER_BOOKING = 4; // manual admin time saved per booking

// Minimum real bookings before a savings figure is shown at all. Below this the percentage-based
// estimate swings wildly on one or two bookings, and an owner who sees a number that jumps around
// (or an implausible one) stops trusting every other number on the page.
const MIN_BOOKINGS_FOR_ESTIMATE = 15;

/**
 * Reports estimated savings from the business's OWN booking data.
 *
 * This replaced a slider-driven calculator. Sliders made the owner invent their own inputs, so the
 * output was really just a reflection of whatever they dragged to — persuasive on a landing page,
 * but meaningless inside an account where the real figures are already known. Everything here is
 * derived from confirmed bookings and their actual prices.
 *
 * planPrice is this business's real current monthly cost (their plan, minus any loyalty discount
 * actually applied), so the net figure is honest about what they specifically pay.
 */
function SavingsSummary({
  lang,
  planPrice,
  confirmedThisMonth,
  revenueThisMonthCents,
}: {
  lang: "he" | "en";
  planPrice: number;
  confirmedThisMonth: number;
  revenueThisMonthCents: number;
}) {
  const he = lang === "he";

  if (confirmedThisMonth < MIN_BOOKINGS_FOR_ESTIMATE) {
    const remaining = MIN_BOOKINGS_FOR_ESTIMATE - confirmedThisMonth;
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6 mt-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-8 h-8 rounded-lg bg-[#1B7FA0]/10 flex items-center justify-center text-base flex-shrink-0" aria-hidden>📈</span>
          <h2 className="text-sm font-semibold text-gray-900">{he ? "החיסכון שלך" : "Your savings"}</h2>
        </div>
        <p className="text-xs text-gray-600 mt-2 leading-relaxed">
          {he
            ? `נציג כאן כמה תורי חסכה לך, מחושב מהתורים האמיתיים שלך. צריך עוד ${remaining} תורים החודש כדי שהחישוב יהיה אמין.`
            : `We'll show what Tori saved you here, calculated from your real bookings. ${remaining} more booking${remaining === 1 ? "" : "s"} this month before the estimate is reliable.`}
        </p>
      </div>
    );
  }

  const avgPrice = revenueThisMonthCents / confirmedThisMonth / 100;
  const recoveredRevenue = Math.round(confirmedThisMonth * AFTER_HOURS_CAPTURE * avgPrice);
  const hoursSaved = Math.max(1, Math.round((confirmedThisMonth * MINUTES_SAVED_PER_BOOKING) / 60));
  const netSavings = Math.max(0, recoveredRevenue - planPrice);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 mt-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-8 h-8 rounded-lg bg-[#1B7FA0]/10 flex items-center justify-center text-base flex-shrink-0" aria-hidden>📈</span>
        <h2 className="text-sm font-semibold text-gray-900">{he ? "החיסכון שלך" : "Your savings"}</h2>
      </div>
      <p className="text-xs text-gray-600 mb-5 mr-10">
        {he
          ? `לפי ${confirmedThisMonth} תורים שנקבעו החודש, במחיר ממוצע של ₪${Math.round(avgPrice)}`
          : `Based on ${confirmedThisMonth} bookings this month, averaging ₪${Math.round(avgPrice)}`}
      </p>

      <div className="bg-[#1B7FA0]/10 border border-[#1B7FA0]/30 rounded-lg p-5 text-center">
        <div className="text-3xl font-extrabold text-[#197492] tabular-nums">₪{netSavings.toLocaleString()}</div>
        <div className="text-xs text-gray-600 mt-1 font-medium">
          {he ? `חיסכון נטו החודש (אחרי עלות המנוי ₪${planPrice})` : `Net savings this month (after the ₪${planPrice} subscription)`}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
          <div className="text-2xl font-extrabold text-gray-900 tabular-nums">₪{recoveredRevenue.toLocaleString()}</div>
          <div className="text-[11px] text-gray-600 mt-1">{he ? "הכנסה משוחזרת" : "Recovered revenue"}</div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
          <div className="text-2xl font-extrabold text-gray-900 tabular-nums">{hoursSaved}</div>
          <div className="text-[11px] text-gray-600 mt-1">{he ? "שעות ניהול שנחסכו" : "Admin hours saved"}</div>
        </div>
      </div>

      <p className="text-[11px] text-gray-600 mt-3 leading-relaxed">
        {he
          ? `הערכה בהנחה ש-${Math.round(AFTER_HOURS_CAPTURE * 100)}% מהתורים נקבעו מחוץ לשעות העבודה והיו אובדים אחרת. מספר התורים והמחיר הממוצע לקוחים מהנתונים האמיתיים שלך.`
          : `Estimate assumes ${Math.round(AFTER_HOURS_CAPTURE * 100)}% of bookings happened after-hours and would otherwise be lost. Booking count and average price come from your real data.`}
      </p>
    </div>
  );
}

export default function BillingPage() {
  const { t, lang } = useLanguage();
  const [status, setStatus] = useState<string | null>(null);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [plan, setPlan] = useState<PlanKey>("standard");
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<string>("monthly");
  const [loyaltyDiscountIls, setLoyaltyDiscountIls] = useState(0);
  const [walletBalanceAgorot, setWalletBalanceAgorot] = useState(0);
  const [annualLoading, setAnnualLoading] = useState(false);
  const [topupAmount, setTopupAmount] = useState(50);
  const [topupLoading, setTopupLoading] = useState(false);
  const [bookingStats, setBookingStats] = useState<{ confirmedThisMonth: number; revenueThisMonth: number } | null>(null);

  async function load() {
    const me = await apiFetch<{
      subscriptionStatus: string; whatsappConnected: boolean; createdAt: string;
      subscriptionPlan?: string | null; billingCycle?: string; loyaltyDiscountIls?: number; walletBalanceAgorot?: number;
    }>("/api/business/me");
    setStatus(me.subscriptionStatus);
    setWhatsappConnected(me.whatsappConnected);
    setCreatedAt(me.createdAt);
    setCurrentPlan(me.subscriptionPlan ?? null);
    if (me.subscriptionPlan && (PLANS as string[]).includes(me.subscriptionPlan)) setPlan(me.subscriptionPlan as PlanKey);
    setBillingCycle(me.billingCycle ?? "monthly");
    setLoyaltyDiscountIls(me.loyaltyDiscountIls ?? 0);
    setWalletBalanceAgorot(me.walletBalanceAgorot ?? 0);

    // Savings are derived from real bookings, so this page needs the analytics figures too.
    // Non-fatal: a failure here should hide the savings card, never block billing itself.
    apiFetch<{ confirmedThisMonth: number; revenueThisMonth: number }>("/api/business/analytics")
      .then(setBookingStats)
      .catch(() => {});
  }

  useEffect(() => {
    load();
  }, []);

  async function switchToAnnual() {
    setError(null);
    setAnnualLoading(true);
    try {
      // A business with a saved card is charged on the spot; one without gets a hosted PayPlus
      // page back instead, and has to go pay before anything changes here.
      const result = await apiFetch<{ ok?: boolean; url?: string; chargedIls?: number; creditedIls?: number }>("/api/billing/payplus/switch-to-annual", {
        method: "POST",
        body: JSON.stringify({ returnUrl: window.location.href }),
      });
      if (result.url) {
        window.location.href = result.url;
        return;
      }
      if (result.creditedIls) {
        alert(
          lang === "he"
            ? `הועברת למנוי שנתי. חויבת ₪${result.chargedIls} — בקיזוז ₪${result.creditedIls} ששילמת כבר על התקופה הנוכחית.`
            : `Switched to annual. Charged ₪${result.chargedIls}, after deducting ₪${result.creditedIls} you had already paid for the current period.`
        );
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch to annual");
    } finally {
      setAnnualLoading(false);
    }
  }

  async function topUpWallet() {
    setError(null);
    setTopupLoading(true);
    try {
      const result = await apiFetch<{ walletBalanceAgorot?: number; url?: string }>("/api/billing/payplus/wallet/topup", {
        method: "POST",
        body: JSON.stringify({ amountIls: topupAmount, returnUrl: window.location.href }),
      });
      // No saved card — pay on a hosted page; the webhook credits the balance on the way back.
      if (result.url) {
        window.location.href = result.url;
        return;
      }
      if (result.walletBalanceAgorot !== undefined) setWalletBalanceAgorot(result.walletBalanceAgorot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not top up wallet");
    } finally {
      setTopupLoading(false);
    }
  }

  async function subscribe(planToCheckout: PlanKey = plan) {
    setError(null);
    setPlan(planToCheckout);
    setCheckoutLoading(true);
    try {
      // PayPlus checkout — charges the first month and stores a token for recurring billing.
      const { url } = await apiFetch<{ url: string }>("/api/billing/payplus/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: planToCheckout, returnUrl: window.location.href }),
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function changePlan(newPlan: PlanKey) {
    setError(null);
    setPlan(newPlan);
    if (status !== "active" || !currentPlan) return; // just a pre-checkout selection, nothing to charge yet
    setCheckoutLoading(true);
    try {
      const result = await apiFetch<{ ok: boolean; proratedChargeIls?: number }>("/api/billing/payplus/plan", {
        method: "PUT",
        body: JSON.stringify({ plan: newPlan }),
      });
      setCurrentPlan(newPlan);
      if (result.proratedChargeIls) {
        // no dedicated toast system on this page — a brief confirmation is enough here
        alert(lang === "he" ? `חויבת ₪${result.proratedChargeIls} עבור יתרת התקופה` : `Charged ₪${result.proratedChargeIls} for the remainder of this period`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change plan");
    } finally {
      setCheckoutLoading(false);
    }
  }


  const statusKey = status as keyof typeof t.billingStatuses | null;
  const info = statusKey && t.billingStatuses[statusKey] ? t.billingStatuses[statusKey] : null;
  const color = status ? STATUS_COLORS[status] : "";
  const sharedFeatures = lang === "he" ? SHARED_FEATURES_HE : SHARED_FEATURES_EN;

  let trialDaysLeft: number | null = null;
  if (status === "trial" && createdAt) {
    const trialEnd = new Date(createdAt).getTime() + 14 * 24 * 60 * 60 * 1000;
    trialDaysLeft = Math.max(0, Math.ceil((trialEnd - Date.now()) / (24 * 60 * 60 * 1000)));
  }

  // The business's actual current monthly cost: their real plan (once subscribed), spread over the
  // annual cycle where applicable, minus any loyalty discount actually applied — falls back to the
  // pre-checkout selected plan's list price before a subscription exists, so the savings card below
  // is never showing a fabricated number.
  //
  // The annual term charges ANNUAL_MONTHS_CHARGED months for 12 months of service, so an annual
  // subscriber's effective monthly cost is lower than the list price. Omitting that overstated
  // their cost by ~17% and therefore understated the savings from the very discount they bought.
  const activePlan: PlanKey =
    status === "active" && currentPlan && (PLANS as string[]).includes(currentPlan)
      ? (currentPlan as PlanKey)
      : status === "active"
        ? "standard"
        : plan;
  const listMonthlyPrice =
    billingCycle === "annual"
      ? (PLAN_PRICES[activePlan] * ANNUAL_MONTHS_CHARGED) / 12
      : PLAN_PRICES[activePlan];
  const realMonthlyPrice = Math.max(0, Math.round(listMonthlyPrice - (status === "active" ? loyaltyDiscountIls : 0)));

  return (
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{t.billingTitle}</h1>
        <p className="text-gray-600 text-sm mt-1">{t.billingSubtitle}</p>
      </div>

      {!whatsappConnected && status !== null && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-xl px-4 py-3 mb-4">
          {t.whatsappWarning}
        </div>
      )}

      {status === null ? (
        <div className="grid sm:grid-cols-2 gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-6 flex flex-col gap-3">
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="h-9 w-28" />
              {Array.from({ length: 5 }).map((_, j) => <SkeletonBlock key={j} className="h-3.5 w-full" />)}
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Status strip — only when there is something to say. On an active subscription it read
              "הכל טוב — המנוי פעיל והבוט עובד", which is a whole row spent restating what the plan
              card below already shows. Trial (days left), past-due and canceled all carry a real
              instruction, so those keep it. */}
          {status !== "active" && (
          <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-5 py-3.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center flex-shrink-0 text-sm">
              {status === "active" ? "✅" : status === "trial" ? "🎁" : status === "past_due" ? "⚠️" : "⏸️"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-900">{info?.label}</span>
                {trialDaysLeft !== null && (
                  <span className="text-xs font-medium text-amber-700">
                    {lang === "he" ? `· ${trialDaysLeft} ימים נותרו` : `· ${trialDaysLeft} days left`}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-600 mt-0.5">{info?.description}</p>
            </div>
          </div>
          )}

          {/* Once a subscription is live, the full marketing comparison (ribbons, repeated feature
              checklists) is just noise — a business that already subscribed doesn't need to be
              re-sold. Past-due is treated like "not active" here since they need the full choice
              again to fix payment, same as trial/canceled. */}
          {status === "active" ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">
                    {PLAN_LABEL[activePlan]}
                  </span>
                  <div className="flex items-baseline gap-1">
                    {loyaltyDiscountIls > 0 && (
                      <span className="text-xs text-gray-600 line-through tabular-nums">₪{PLAN_PRICES[activePlan]}</span>
                    )}
                    <span className="text-lg font-extrabold text-gray-900 tabular-nums">₪{realMonthlyPrice}</span>
                    <span className="text-xs text-gray-600">{lang === "he" ? "/חודש" : "/month"}</span>
                  </div>
                </div>
                {loyaltyDiscountIls > 0 ? (
                  <p className="text-xs font-medium text-green-700 mt-0.5">
                    🎁 {lang === "he" ? "הנחת נאמנות מוחלת אוטומטית" : "Loyalty discount applied automatically"}
                  </p>
                ) : (
                  <p className="text-xs text-gray-600 mt-0.5">
                    {lang === "he"
                      ? `עד ${MESSAGE_QUOTA_BY_PLAN[activePlan].toLocaleString()} הודעות תזכורת/ביקורת בחודש`
                      : `Up to ${MESSAGE_QUOTA_BY_PLAN[activePlan].toLocaleString()} reminder/review messages/month`}
                  </p>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                {/* One button per plan they are not on. With three plans a binary toggle stopped
                    meaning anything; naming the destination is what makes the click informed. */}
                {PLANS.filter((p) => p !== activePlan).map((p) => (
                  <button
                    key={p}
                    onClick={() => changePlan(p)}
                    disabled={checkoutLoading}
                    className="inline-flex items-center justify-center gap-1.5 bg-gray-50 hover:bg-gray-100 disabled:opacity-50 text-gray-700 border border-gray-200 text-sm font-semibold px-4 py-2 rounded-lg transition"
                  >
                    {checkoutLoading
                      ? t.redirecting
                      : PLAN_PRICES[p] > PLAN_PRICES[activePlan]
                        ? (lang === "he" ? `שדרג ל-${PLAN_LABEL[p]}` : `Upgrade to ${PLAN_LABEL[p]}`)
                        : (lang === "he" ? `עבור ל-${PLAN_LABEL[p]}` : `Switch to ${PLAN_LABEL[p]}`)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
          <div className="grid sm:grid-cols-3 gap-4">
            {PLANS.map((p) => {
              const isCurrent = currentPlan === p && status === "active";
              const isSelected = plan === p;
              const priceAfterDiscount = Math.max(0, PLAN_PRICES[p] - (p === plan ? loyaltyDiscountIls : 0));
              return (
                <div
                  key={p}
                  className={`relative bg-white border rounded-xl p-6 flex flex-col transition ${
                    isSelected ? "border-[#1B7FA0] shadow-[0_0_0_1px_#1B7FA0]" : "border-gray-200"
                  }`}
                >
                  {p === "premium" && (
                    <span className="absolute -top-2.5 right-5 bg-[#B45309] text-white text-[10px] font-bold px-2.5 py-1 rounded-full tracking-wide">
                      {lang === "he" ? "הכי פופולרי" : "MOST POPULAR"}
                    </span>
                  )}
                  {isCurrent && (
                    <span className="absolute -top-2.5 left-5 bg-green-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-full tracking-wide">
                      {lang === "he" ? "התוכנית שלך" : "YOUR PLAN"}
                    </span>
                  )}

                  <span className="text-sm font-bold text-gray-900 mb-2">{PLAN_LABEL[p]}</span>
                  <div className="flex items-baseline gap-1 mb-1">
                    {p === plan && loyaltyDiscountIls > 0 && (
                      <span className="text-base text-gray-600 line-through tabular-nums">₪{PLAN_PRICES[p]}</span>
                    )}
                    <span className="text-3xl font-extrabold text-gray-900 tabular-nums">₪{priceAfterDiscount}</span>
                    <span className="text-sm text-gray-600">{lang === "he" ? "/חודש" : "/month"}</span>
                  </div>
                  {p === plan && loyaltyDiscountIls > 0 && (
                    <p className="text-xs font-medium text-green-700 mb-2">
                      🎁 {lang === "he" ? "הנחת נאמנות מוחלת אוטומטית" : "Loyalty discount applied automatically"}
                    </p>
                  )}

                  <ul className="flex flex-col gap-2 my-4">
                    {sharedFeatures.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                        <svg className="w-4 h-4 text-[#197492] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        {f}
                      </li>
                    ))}
                    <li className="flex items-center gap-2 text-sm text-gray-900 font-medium">
                      <svg className="w-4 h-4 text-[#197492] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {lang === "he"
                        ? `עד ${MESSAGE_QUOTA_BY_PLAN[p].toLocaleString()} הודעות תזכורת/ביקורת בחודש`
                        : `Up to ${MESSAGE_QUOTA_BY_PLAN[p].toLocaleString()} reminder/review messages/month`}
                    </li>
                    {p === "ultra" && (
                      <li className="flex items-center gap-2 text-sm text-gray-900 font-medium">
                        <svg className="w-4 h-4 text-[#197492] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        {lang === "he" ? "תמיכה מועדפת וליווי הקמה אישי" : "Priority support and personal onboarding"}
                      </li>
                    )}
                    {p !== "standard" && (
                      <li className="flex items-center gap-2 text-sm text-gray-600">
                        <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-amber-700">🔜</span>
                        <span>
                          {lang === "he" ? "מענה טלפוני חכם ב-AI" : "AI phone-call answering"}
                          <span className="ms-1.5 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 align-middle">
                            {lang === "he" ? "בקרוב" : "SOON"}
                          </span>
                        </span>
                      </li>
                    )}
                  </ul>

                  <div className="mt-auto flex flex-col gap-2">
                    {status !== "active" ? (
                      <button
                        onClick={() => subscribe(p)}
                        disabled={checkoutLoading}
                        className={`w-full inline-flex items-center justify-center gap-2 disabled:opacity-50 text-sm font-semibold px-4 py-2.5 rounded-lg transition ${
                          isSelected ? "bg-[#1B7FA0] hover:bg-[#2A9BBF] text-white" : "bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200"
                        }`}
                      >
                        {checkoutLoading && isSelected ? t.redirecting : status === "trial" ? t.subscribeNow : t.reactivate}
                      </button>
                    ) : isCurrent ? (
                      <button disabled className="w-full text-sm font-semibold px-4 py-2.5 rounded-lg bg-gray-50 text-gray-600 border border-gray-200 cursor-default">
                        {lang === "he" ? "התוכנית הנוכחית שלך" : "Your current plan"}
                      </button>
                    ) : (
                      <button
                        onClick={() => changePlan(p)}
                        disabled={checkoutLoading}
                        className="w-full inline-flex items-center justify-center gap-2 bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
                      >
                        {checkoutLoading ? t.redirecting : p === "premium"
                          ? (lang === "he" ? "שדרג ל-Premium" : "Upgrade to Premium")
                          : (lang === "he" ? "עבור ל-Standard" : "Switch to Standard")}
                      </button>
                    )}
                    {status === "past_due" && (
                      <button
                        onClick={() => subscribe()}
                        disabled={checkoutLoading}
                        className="w-full inline-flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 text-sm font-semibold px-4 py-2 rounded-lg transition"
                      >
                        {checkoutLoading ? t.redirecting : t.manageBilling}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          )}

          {error && <p className="text-red-600 text-xs mt-3">{error}</p>}
        </>
      )}

      {status === "active" && (
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          {/* Annual plan — 2 months free, i.e. the same yearly cost spread over 10 months instead
              of 12. Leads with the effective monthly price (what actually changes on their bill)
              rather than a lump year total, since that's the number that actually answers "is this
              worth it" at a glance. */}
          <div className={`relative rounded-xl p-5 overflow-hidden ${billingCycle === "annual" ? "bg-white border border-gray-200" : "bg-gradient-to-br from-[#1B7FA0] to-[#155F79] border border-[#1B7FA0]"}`}>
            {billingCycle !== "annual" && (
              <span className="absolute top-3 left-3 bg-[#B45309] text-white text-[10px] font-bold px-2.5 py-1 rounded-full tracking-wide">
                {lang === "he" ? "חודשיים מתנה" : "2 MONTHS FREE"}
              </span>
            )}
            <div className={`flex items-center gap-2 mb-1 ${billingCycle !== "annual" ? "mt-6" : ""}`}>
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0 ${billingCycle === "annual" ? "bg-[#1B7FA0]/10" : "bg-white/15"}`}>📅</span>
              <h2 className={`text-sm font-semibold ${billingCycle === "annual" ? "text-gray-900" : "text-white"}`}>
                {lang === "he" ? "מנוי שנתי" : "Annual plan"}
              </h2>
            </div>
            {billingCycle === "annual" ? (
              <p className="text-sm text-gray-600 mt-3">
                {lang === "he" ? "אתה כבר במסלול השנתי — תודה! 🎉" : "You're already on the annual plan — thank you! 🎉"}
              </p>
            ) : (
              <>
                <div className="flex items-baseline gap-1.5 mt-3">
                  <span className="text-white/50 text-base line-through tabular-nums">₪{PLAN_PRICES[activePlan]}</span>
                  <span className="text-3xl font-extrabold text-white tabular-nums">₪{Math.round((PLAN_PRICES[activePlan] * 10) / 12)}</span>
                  <span className="text-sm text-white/70">{lang === "he" ? "/חודש בממוצע" : "/mo on average"}</span>
                </div>
                <p className="text-xs text-white/80 mt-2 mb-4 leading-relaxed">
                  {lang === "he"
                    ? `₪${PLAN_PRICES[activePlan] * 10} לשנה במקום ₪${PLAN_PRICES[activePlan] * 12} — חוסך לך ₪${PLAN_PRICES[activePlan] * 2} בשנה, מחויב פעם אחת.`
                    : `₪${PLAN_PRICES[activePlan] * 10}/year instead of ₪${PLAN_PRICES[activePlan] * 12} — saves you ₪${PLAN_PRICES[activePlan] * 2}/year, billed once.`}
                </p>
                {/* Said before they commit, not discovered on the payment page. Switching mid-month
                    used to charge the full annual price on top of a month already paid for. */}
                <p className="text-xs text-white/70 -mt-2 mb-4 leading-relaxed">
                  {lang === "he"
                    ? "מה ששילמת על התקופה הנוכחית ועוד לא ניצלת יקוזז מהסכום."
                    : "Whatever you've already paid for the current period and not used is deducted."}
                </p>
                <button
                  onClick={switchToAnnual}
                  disabled={annualLoading}
                  className="bg-white hover:bg-gray-50 disabled:opacity-50 text-[#197492] text-sm font-bold px-4 py-2 rounded-lg transition"
                >
                  {annualLoading ? t.redirecting : (lang === "he" ? "עבור למנוי שנתי" : "Switch to annual")}
                </button>
              </>
            )}
          </div>

          {/* Wallet top-up */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-[#1B7FA0]/10 flex items-center justify-center text-base flex-shrink-0">💳</span>
                <h2 className="text-sm font-semibold text-gray-900">{lang === "he" ? "ארנק הודעות" : "Message wallet"}</h2>
              </div>
              <span className={`text-sm font-bold tabular-nums ${walletBalanceAgorot < 0 ? "text-red-600" : "text-[#197492]"}`}>
                ₪{(walletBalanceAgorot / 100).toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-gray-600 mt-1 mb-4">
              {lang === "he" ? "יתרה לשימוש עתידי בהודעות/SMS נוספים מעבר למכסת המנוי." : "Prepaid balance for future extra WhatsApp/SMS sends beyond your plan quota."}
            </p>
            <div className="flex items-center gap-2">
              <select value={topupAmount} onChange={(e) => setTopupAmount(+e.target.value)} className="text-sm" aria-label={lang === "he" ? "סכום טעינה" : "Top-up amount"}>
                {[20, 50, 100, 200].map((v) => <option key={v} value={v}>₪{v}</option>)}
              </select>
              <button
                onClick={topUpWallet}
                disabled={topupLoading}
                className="bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 text-sm font-semibold px-4 py-2 rounded-lg transition"
              >
                {topupLoading ? t.redirecting : (lang === "he" ? "טען יתרה" : "Top up")}
              </button>
            </div>
          </div>
        </div>
      )}

      {bookingStats && (
        <SavingsSummary
          lang={lang}
          planPrice={realMonthlyPrice}
          confirmedThisMonth={bookingStats.confirmedThisMonth}
          revenueThisMonthCents={bookingStats.revenueThisMonth}
        />
      )}
    </div>
  );
}
