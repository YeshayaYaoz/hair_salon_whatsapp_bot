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

const PLAN_PRICE = 149; // ₪/month
const PLAN_FEATURES_HE = [
  "בוט WhatsApp פעיל 24/7",
  "קביעת תורים ותזכורות אוטומטיות",
  "סנכרון מלא עם Google Calendar",
  "דשבורד ניהול ואנליטיקס",
  "תמיכה טכנית ללא הגבלה",
];
const PLAN_FEATURES_EN = [
  "24/7 active WhatsApp bot",
  "Automatic booking & reminders",
  "Full Google Calendar sync",
  "Management dashboard & analytics",
  "Unlimited technical support",
];

const WEEKS_PER_MONTH = 4.33;
const AFTER_HOURS_CAPTURE = 0.15; // share of bookings recovered by answering 24/7
const MINUTES_SAVED_PER_BOOKING = 4; // manual admin time saved per booking

function SavingsCalculator({ lang }: { lang: "he" | "en" }) {
  const [weekly, setWeekly] = useState(30);
  const [price, setPrice] = useState(120);
  const he = lang === "he";

  const monthlyBookings = Math.round(weekly * WEEKS_PER_MONTH);
  const recoveredRevenue = Math.round(monthlyBookings * AFTER_HOURS_CAPTURE * price);
  const hoursSaved = Math.max(1, Math.round((monthlyBookings * MINUTES_SAVED_PER_BOOKING) / 60));
  const netSavings = Math.max(0, recoveredRevenue - PLAN_PRICE);
  const coversSubscription = recoveredRevenue >= PLAN_PRICE;

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
          {he ? `חיסכון נטו לחודש (אחרי עלות המנוי ₪${PLAN_PRICE})` : `Net monthly savings (after the ₪${PLAN_PRICE} subscription)`}
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
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ subscriptionStatus: string; whatsappConnected: boolean; createdAt: string }>("/api/business/me").then((me) => {
      setStatus(me.subscriptionStatus);
      setWhatsappConnected(me.whatsappConnected);
      setCreatedAt(me.createdAt);
    });
  }, []);

  async function subscribe() {
    setError(null);
    setCheckoutLoading(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ returnUrl: window.location.href }),
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function openPortal() {
    setError(null);
    setPortalLoading(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/billing/portal", {
        method: "POST",
        body: JSON.stringify({ returnUrl: window.location.href }),
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing portal");
    } finally {
      setPortalLoading(false);
    }
  }

  const statusKey = status as keyof typeof t.billingStatuses | null;
  const info = statusKey && t.billingStatuses[statusKey] ? t.billingStatuses[statusKey] : null;
  const color = status ? STATUS_COLORS[status] : "";
  const features = lang === "he" ? PLAN_FEATURES_HE : PLAN_FEATURES_EN;

  let trialDaysLeft: number | null = null;
  if (status === "trial" && createdAt) {
    const trialEnd = new Date(createdAt).getTime() + 14 * 24 * 60 * 60 * 1000;
    trialDaysLeft = Math.max(0, Math.ceil((trialEnd - Date.now()) / (24 * 60 * 60 * 1000)));
  }

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

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {status === null ? (
          <div className="grid md:grid-cols-2">
            <div className="p-6 border-b md:border-b-0 md:border-l border-gray-100 flex flex-col gap-3">
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="h-9 w-28" />
              <SkeletonBlock className="h-3 w-40 mb-2" />
              {Array.from({ length: 5 }).map((_, i) => <SkeletonBlock key={i} className="h-3.5 w-full" />)}
            </div>
            <div className="p-6 bg-gray-50/60 flex items-center gap-3">
              <SkeletonBlock className="h-9 w-9 rounded-lg shrink-0" />
              <div className="flex-1 flex flex-col gap-2">
                <SkeletonBlock className="h-3.5 w-32" />
                <SkeletonBlock className="h-3 w-full" />
              </div>
            </div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2">
            {/* Plan summary */}
            <div className="p-6 border-b md:border-b-0 md:border-l border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {lang === "he" ? "תוכנית תורי" : "Tori Plan"}
                </span>
                {info && (
                  <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full border ${color}`}>
                    {info.label}
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-3xl font-extrabold text-gray-900 tabular-nums">₪{PLAN_PRICE}</span>
                <span className="text-sm text-gray-400">{lang === "he" ? "/חודש" : "/month"}</span>
              </div>
              {trialDaysLeft !== null && (
                <p className="text-xs font-medium text-amber-600 mb-4">
                  {lang === "he" ? `${trialDaysLeft} ימים נותרו בתקופת הניסיון` : `${trialDaysLeft} days left in your trial`}
                </p>
              )}
              {trialDaysLeft === null && <p className="text-sm text-gray-500 mb-4">{info?.description}</p>}

              <ul className="flex flex-col gap-2 mb-5">
                {features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                    <svg className="w-4 h-4 text-[#1B7FA0] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-2">
                {status !== "active" && (
                  <button
                    onClick={subscribe}
                    disabled={checkoutLoading}
                    className="inline-flex items-center justify-center gap-2 bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
                  >
                    {checkoutLoading ? t.redirecting : status === "trial" ? t.subscribeNow : t.reactivate}
                  </button>
                )}
                {(status === "active" || status === "past_due") && (
                  <button
                    onClick={openPortal}
                    disabled={portalLoading}
                    className="inline-flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 text-sm font-semibold px-4 py-2 rounded-lg transition"
                  >
                    {portalLoading ? t.redirecting : t.manageBilling}
                  </button>
                )}
              </div>

              {error && <p className="text-red-600 text-xs mt-3">{error}</p>}
            </div>

            {/* Status detail panel */}
            <div className="p-6 bg-gray-50/60 flex flex-col justify-center">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center flex-shrink-0 text-base">
                  {status === "active" ? "✅" : status === "trial" ? "🎁" : status === "past_due" ? "⚠️" : "⏸️"}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{info?.label}</p>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">{info?.description}</p>
                </div>
              </div>
              {status === "active" && (
                <button
                  onClick={openPortal}
                  disabled={portalLoading}
                  className="text-xs text-[#1B7FA0] hover:text-[#145F78] font-medium mt-4 self-start underline underline-offset-2"
                >
                  {lang === "he" ? "צפייה בחשבוניות וכרטיס אשראי ←" : "View invoices & payment method →"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <SavingsCalculator lang={lang} />
    </div>
  );
}
