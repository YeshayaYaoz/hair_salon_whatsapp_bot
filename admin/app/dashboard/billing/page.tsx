"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SkeletonBlock } from "../../lib/Skeleton";

const STATUS_COLORS: Record<string, string> = {
  trial: "bg-amber-50 text-amber-700 border-amber-200",
  active: "bg-green-50 text-green-700 border-green-200",
  past_due: "bg-red-50 text-red-600 border-red-200",
  canceled: "bg-gray-100 text-gray-500 border-gray-200",
};

const PLAN_PRICES: Record<"standard" | "premium", number> = { standard: 149, premium: 299 };

// Must match MESSAGE_QUOTA_BY_PLAN in backend/src/lib/wallet.ts — display-only, not authoritative.
const MESSAGE_QUOTA_BY_PLAN: Record<"standard" | "premium", number> = { standard: 300, premium: 1000 };

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

const WEEKS_PER_MONTH = 4.33;
const AFTER_HOURS_CAPTURE = 0.15; // share of bookings recovered by answering 24/7
const MINUTES_SAVED_PER_BOOKING = 4; // manual admin time saved per booking

// planPrice is the business's actual current monthly cost (real plan price, minus any loyalty
// discount actually applied to their account) — not a fixed constant — so the "net savings after
// subscription" figure below is honest about what this specific business pays, not a generic quote.
function SavingsCalculator({ lang, planPrice }: { lang: "he" | "en"; planPrice: number }) {
  const [weekly, setWeekly] = useState(30);
  const [price, setPrice] = useState(120);
  const he = lang === "he";

  const monthlyBookings = Math.round(weekly * WEEKS_PER_MONTH);
  const recoveredRevenue = Math.round(monthlyBookings * AFTER_HOURS_CAPTURE * price);
  const hoursSaved = Math.max(1, Math.round((monthlyBookings * MINUTES_SAVED_PER_BOOKING) / 60));
  const netSavings = Math.max(0, recoveredRevenue - planPrice);
  const coversSubscription = recoveredRevenue >= planPrice;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 mt-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-8 h-8 rounded-lg bg-[#1B7FA0]/10 flex items-center justify-center text-base flex-shrink-0">🧮</span>
        <h2 className="text-sm font-semibold text-gray-900">{he ? "מחשבון חיסכון" : "Savings calculator"}</h2>
      </div>
      <p className="text-xs text-gray-500 mb-6 mr-10">
        {he ? "הזז את המחוונים לפי המספרים האמיתיים של העסק שלך" : "Adjust the sliders to match your business's real numbers"}
      </p>

      <div className="flex flex-col gap-6">
        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-gray-600">{he ? "תורים בשבוע" : "Appointments per week"}</span>
            <span className="font-bold text-[#1B7FA0] tabular-nums bg-[#1B7FA0]/10 px-2.5 py-0.5 rounded-md">{weekly}</span>
          </div>
          <input
            type="range"
            min={10}
            max={150}
            value={weekly}
            onChange={(e) => setWeekly(+e.target.value)}
            className="w-full accent-[#1B7FA0]"
          />
          <div className="flex justify-between text-[11px] text-gray-400 mt-1 tabular-nums">
            <span>10</span>
            <span>150</span>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-gray-600">{he ? "מחיר ממוצע לתור" : "Average price per appointment"}</span>
            <span className="font-bold text-[#1B7FA0] tabular-nums bg-[#1B7FA0]/10 px-2.5 py-0.5 rounded-md">₪{price}</span>
          </div>
          <input
            type="range"
            min={50}
            max={500}
            step={10}
            value={price}
            onChange={(e) => setPrice(+e.target.value)}
            className="w-full accent-[#1B7FA0]"
          />
          <div className="flex justify-between text-[11px] text-gray-400 mt-1 tabular-nums">
            <span>₪50</span>
            <span>₪500</span>
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-500 mt-6 mb-3">
        {he
          ? `כלומר בערך ${monthlyBookings} תורים בחודש. תורי עוזרת לתפוס תורים שהיו הולכים לאיבוד מחוץ לשעות העבודה:`
          : `That's about ${monthlyBookings} appointments per month. Tori helps capture bookings that would otherwise be lost after-hours:`}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
          <div className="text-2xl font-extrabold text-gray-900 tabular-nums">₪{recoveredRevenue.toLocaleString()}</div>
          <div className="text-[11px] text-gray-500 mt-1">{he ? "הכנסה משוחזרת לחודש" : "Recovered revenue / month"}</div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
          <div className="text-2xl font-extrabold text-gray-900 tabular-nums">{hoursSaved}</div>
          <div className="text-[11px] text-gray-500 mt-1">{he ? "שעות ניהול שנחסכו" : "Admin hours saved"}</div>
        </div>
      </div>

      <div className="bg-[#1B7FA0]/10 border border-[#1B7FA0]/30 rounded-lg p-4 text-center mt-3">
        <div className="text-3xl font-extrabold text-[#1B7FA0] tabular-nums">
          {coversSubscription ? `₪${netSavings.toLocaleString()}` : "₪0"}
        </div>
        <div className="text-xs text-gray-600 mt-1 font-medium">
          {he ? `חיסכון נטו לחודש (אחרי עלות המנוי ₪${planPrice})` : `Net monthly savings (after the ₪${planPrice} subscription)`}
        </div>
      </div>

      {!coversSubscription && (
        <p className="text-[11px] text-amber-600 mt-3 leading-relaxed">
          {he
            ? "בנפח נמוך מאוד ההחזר עדיין קטן — הגדל את המחוון כדי לראות איך התשואה גדלה ככל שיש יותר תורים."
            : "At very low volume the return is still small — try increasing the slider to see how it grows with more bookings."}
        </p>
      )}

      <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
        {he
          ? `הערכה בהנחה ש-${Math.round(AFTER_HOURS_CAPTURE * 100)}% מהתורים נקבעים מחוץ לשעות העבודה, שאחרת היו אובדים. למטרות המחשה בלבד.`
          : `Estimate assumes ${Math.round(AFTER_HOURS_CAPTURE * 100)}% of bookings happen after-hours and would otherwise be lost. For illustration only.`}
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
  const [plan, setPlan] = useState<"standard" | "premium">("standard");
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<string>("monthly");
  const [loyaltyDiscountIls, setLoyaltyDiscountIls] = useState(0);
  const [walletBalanceAgorot, setWalletBalanceAgorot] = useState(0);
  const [annualLoading, setAnnualLoading] = useState(false);
  const [topupAmount, setTopupAmount] = useState(50);
  const [topupLoading, setTopupLoading] = useState(false);

  async function load() {
    const me = await apiFetch<{
      subscriptionStatus: string; whatsappConnected: boolean; createdAt: string;
      subscriptionPlan?: string | null; billingCycle?: string; loyaltyDiscountIls?: number; walletBalanceAgorot?: number;
    }>("/api/business/me");
    setStatus(me.subscriptionStatus);
    setWhatsappConnected(me.whatsappConnected);
    setCreatedAt(me.createdAt);
    setCurrentPlan(me.subscriptionPlan ?? null);
    if (me.subscriptionPlan === "premium" || me.subscriptionPlan === "standard") setPlan(me.subscriptionPlan);
    setBillingCycle(me.billingCycle ?? "monthly");
    setLoyaltyDiscountIls(me.loyaltyDiscountIls ?? 0);
    setWalletBalanceAgorot(me.walletBalanceAgorot ?? 0);
  }

  useEffect(() => {
    load();
  }, []);

  async function switchToAnnual() {
    setError(null);
    setAnnualLoading(true);
    try {
      await apiFetch("/api/billing/payplus/switch-to-annual", { method: "POST" });
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
      const result = await apiFetch<{ walletBalanceAgorot: number }>("/api/billing/payplus/wallet/topup", {
        method: "POST",
        body: JSON.stringify({ amountIls: topupAmount }),
      });
      setWalletBalanceAgorot(result.walletBalanceAgorot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not top up wallet");
    } finally {
      setTopupLoading(false);
    }
  }

  async function subscribe(planToCheckout: "standard" | "premium" = plan) {
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

  async function changePlan(newPlan: "standard" | "premium") {
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

  // The business's actual current monthly cost: their real plan (once subscribed) minus any
  // loyalty discount actually applied — falls back to the pre-checkout selected plan's list price
  // before a subscription exists, so the calculator below is never showing a fabricated number.
  const activePlan = (status === "active" && currentPlan === "premium" ? "premium" : status === "active" ? "standard" : plan) as "standard" | "premium";
  const realMonthlyPrice = Math.max(0, PLAN_PRICES[activePlan] - (status === "active" ? loyaltyDiscountIls : 0));

  return (
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{t.billingTitle}</h1>
        <p className="text-gray-500 text-sm mt-1">{t.billingSubtitle}</p>
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
          {/* Current status strip */}
          <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-5 py-3.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center flex-shrink-0 text-sm">
              {status === "active" ? "✅" : status === "trial" ? "🎁" : status === "past_due" ? "⚠️" : "⏸️"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-900">{info?.label}</span>
                {trialDaysLeft !== null && (
                  <span className="text-xs font-medium text-amber-600">
                    {lang === "he" ? `· ${trialDaysLeft} ימים נותרו` : `· ${trialDaysLeft} days left`}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{info?.description}</p>
            </div>
          </div>

          {/* Once a subscription is live, the full marketing comparison (ribbons, repeated feature
              checklists) is just noise — a business that already subscribed doesn't need to be
              re-sold. Past-due is treated like "not active" here since they need the full choice
              again to fix payment, same as trial/canceled. */}
          {status === "active" ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">
                    {currentPlan === "premium" ? "Premium" : "Standard"}
                  </span>
                  <div className="flex items-baseline gap-1">
                    {loyaltyDiscountIls > 0 && (
                      <span className="text-xs text-gray-400 line-through tabular-nums">₪{PLAN_PRICES[activePlan]}</span>
                    )}
                    <span className="text-lg font-extrabold text-gray-900 tabular-nums">₪{realMonthlyPrice}</span>
                    <span className="text-xs text-gray-400">{lang === "he" ? "/חודש" : "/month"}</span>
                  </div>
                </div>
                {loyaltyDiscountIls > 0 ? (
                  <p className="text-xs font-medium text-green-600 mt-0.5">
                    🎁 {lang === "he" ? "הנחת נאמנות מוחלת אוטומטית" : "Loyalty discount applied automatically"}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {lang === "he"
                      ? `עד ${MESSAGE_QUOTA_BY_PLAN[activePlan].toLocaleString()} הודעות תזכורת/ביקורת בחודש`
                      : `Up to ${MESSAGE_QUOTA_BY_PLAN[activePlan].toLocaleString()} reminder/review messages/month`}
                  </p>
                )}
              </div>
              <button
                onClick={() => changePlan(activePlan === "premium" ? "standard" : "premium")}
                disabled={checkoutLoading}
                className="inline-flex items-center justify-center gap-1.5 bg-gray-50 hover:bg-gray-100 disabled:opacity-50 text-gray-700 border border-gray-200 text-sm font-semibold px-4 py-2 rounded-lg transition"
              >
                {checkoutLoading
                  ? t.redirecting
                  : activePlan === "premium"
                    ? (lang === "he" ? "עבור ל-Standard" : "Switch to Standard")
                    : (lang === "he" ? "שדרג ל-Premium" : "Upgrade to Premium")}
              </button>
            </div>
          ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {(["standard", "premium"] as const).map((p) => {
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
                    <span className="absolute -top-2.5 right-5 bg-[#F59E0B] text-white text-[10px] font-bold px-2.5 py-1 rounded-full tracking-wide">
                      {lang === "he" ? "הכי פופולרי" : "MOST POPULAR"}
                    </span>
                  )}
                  {isCurrent && (
                    <span className="absolute -top-2.5 left-5 bg-green-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-full tracking-wide">
                      {lang === "he" ? "התוכנית שלך" : "YOUR PLAN"}
                    </span>
                  )}

                  <span className="text-sm font-bold text-gray-900 mb-2">{p === "standard" ? "Standard" : "Premium"}</span>
                  <div className="flex items-baseline gap-1 mb-1">
                    {p === plan && loyaltyDiscountIls > 0 && (
                      <span className="text-base text-gray-400 line-through tabular-nums">₪{PLAN_PRICES[p]}</span>
                    )}
                    <span className="text-3xl font-extrabold text-gray-900 tabular-nums">₪{priceAfterDiscount}</span>
                    <span className="text-sm text-gray-400">{lang === "he" ? "/חודש" : "/month"}</span>
                  </div>
                  {p === plan && loyaltyDiscountIls > 0 && (
                    <p className="text-xs font-medium text-green-600 mb-2">
                      🎁 {lang === "he" ? "הנחת נאמנות מוחלת אוטומטית" : "Loyalty discount applied automatically"}
                    </p>
                  )}

                  <ul className="flex flex-col gap-2 my-4">
                    {sharedFeatures.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                        <svg className="w-4 h-4 text-[#1B7FA0] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        {f}
                      </li>
                    ))}
                    <li className="flex items-center gap-2 text-sm text-gray-900 font-medium">
                      <svg className="w-4 h-4 text-[#1B7FA0] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {lang === "he"
                        ? `עד ${MESSAGE_QUOTA_BY_PLAN[p].toLocaleString()} הודעות תזכורת/ביקורת בחודש`
                        : `Up to ${MESSAGE_QUOTA_BY_PLAN[p].toLocaleString()} reminder/review messages/month`}
                    </li>
                    {p === "premium" && (
                      <li className="flex items-center gap-2 text-sm text-gray-400">
                        <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-amber-500">🔜</span>
                        <span>
                          {lang === "he" ? "מענה טלפוני חכם ב-AI" : "AI phone-call answering"}
                          <span className="ms-1.5 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 align-middle">
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
                      <button disabled className="w-full text-sm font-semibold px-4 py-2.5 rounded-lg bg-gray-50 text-gray-400 border border-gray-200 cursor-default">
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
              <span className="absolute top-3 left-3 bg-[#F59E0B] text-white text-[10px] font-bold px-2.5 py-1 rounded-full tracking-wide">
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
              <p className="text-sm text-gray-500 mt-3">
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
                <button
                  onClick={switchToAnnual}
                  disabled={annualLoading}
                  className="bg-white hover:bg-gray-50 disabled:opacity-50 text-[#1B7FA0] text-sm font-bold px-4 py-2 rounded-lg transition"
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
              <span className={`text-sm font-bold tabular-nums ${walletBalanceAgorot < 0 ? "text-red-600" : "text-[#1B7FA0]"}`}>
                ₪{(walletBalanceAgorot / 100).toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1 mb-4">
              {lang === "he" ? "יתרה לשימוש עתידי בהודעות/SMS נוספים מעבר למכסת המנוי." : "Prepaid balance for future extra WhatsApp/SMS sends beyond your plan quota."}
            </p>
            <div className="flex items-center gap-2">
              <select value={topupAmount} onChange={(e) => setTopupAmount(+e.target.value)} className="text-sm">
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

      <SavingsCalculator lang={lang} planPrice={realMonthlyPrice} />
    </div>
  );
}
