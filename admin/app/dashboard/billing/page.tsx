"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";

const STATUS_COLORS: Record<string, string> = {
  trial: "bg-yellow-950/50 text-yellow-400 border-yellow-800",
  active: "bg-green-50 text-green-700 border-green-200",
  past_due: "bg-red-950/50 text-red-600 border-red-200",
  canceled: "bg-gray-100 text-gray-500 border-gray-200",
};

const SUBSCRIPTION_COST = 149; // ₪/month
const WEEKS_PER_MONTH = 4.33;
const AFTER_HOURS_CAPTURE = 0.15; // share of bookings recovered by answering 24/7
const MINUTES_SAVED_PER_BOOKING = 4; // manual admin time saved per booking

function SavingsCalculator({ lang }: { lang: "he" | "en" }) {
  const [weekly, setWeekly] = useState(40);
  const [price, setPrice] = useState(120);
  const he = lang === "he";

  const monthlyBookings = weekly * WEEKS_PER_MONTH;
  const recoveredRevenue = Math.round(monthlyBookings * AFTER_HOURS_CAPTURE * price);
  const hoursSaved = Math.round((monthlyBookings * MINUTES_SAVED_PER_BOOKING) / 60);
  const netSavings = recoveredRevenue - SUBSCRIPTION_COST;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 mt-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">🧮</span>
        <h2 className="text-sm font-semibold text-gray-900">{he ? "מחשבון חיסכון" : "Savings calculator"}</h2>
      </div>
      <p className="text-xs text-gray-500 mb-5">
        {he ? "הערכה של החיסכון החודשי שלך עם תורי" : "An estimate of your monthly savings with Tori"}
      </p>

      <div className="flex flex-col gap-5">
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-600">{he ? "תורים בשבוע" : "Appointments per week"}</span>
            <span className="font-bold text-[#1B7FA0]">{weekly}</span>
          </div>
          <input type="range" min={5} max={150} value={weekly} onChange={(e) => setWeekly(+e.target.value)} className="w-full accent-[#1B7FA0]" />
        </div>
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-600">{he ? "מחיר ממוצע לתור (₪)" : "Average price per appointment (₪)"}</span>
            <span className="font-bold text-[#1B7FA0]">₪{price}</span>
          </div>
          <input type="range" min={30} max={500} step={10} value={price} onChange={(e) => setPrice(+e.target.value)} className="w-full accent-[#1B7FA0]" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-6">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
          <div className="text-lg font-extrabold text-gray-900 tabular-nums">₪{recoveredRevenue.toLocaleString()}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{he ? "הכנסה משוחזרת/חודש" : "Recovered revenue/mo"}</div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
          <div className="text-lg font-extrabold text-gray-900 tabular-nums">{hoursSaved}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{he ? "שעות שנחסכו/חודש" : "Hours saved/mo"}</div>
        </div>
        <div className="bg-[#1B7FA0]/10 border border-[#1B7FA0]/30 rounded-lg p-3 text-center">
          <div className="text-lg font-extrabold text-[#1B7FA0] tabular-nums">₪{netSavings.toLocaleString()}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{he ? "חיסכון נטו/חודש" : "Net savings/mo"}</div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">
        {he
          ? `בהנחה ש-${Math.round(AFTER_HOURS_CAPTURE * 100)}% מהתורים נקבעים מחוץ לשעות העבודה (שאחרת היו אובדים), בניכוי עלות המנוי (₪${SUBSCRIPTION_COST}/חודש). הערכה בלבד.`
          : `Assumes ${Math.round(AFTER_HOURS_CAPTURE * 100)}% of bookings happen after-hours (otherwise lost), minus the subscription (₪${SUBSCRIPTION_COST}/mo). Estimate only.`}
      </p>
    </div>
  );
}

export default function BillingPage() {
  const { t, lang } = useLanguage();
  const [status, setStatus] = useState<string | null>(null);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ subscriptionStatus: string; whatsappConnected: boolean }>("/api/business/me").then((me) => {
      setStatus(me.subscriptionStatus);
      setWhatsappConnected(me.whatsappConnected);
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

  return (
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{t.billingTitle}</h1>
        <p className="text-gray-500 text-sm mt-1">{t.billingSubtitle}</p>
      </div>

      {!whatsappConnected && status !== null && (
        <div className="bg-yellow-950/30 border border-yellow-800 text-yellow-400 text-sm rounded-xl px-4 py-3 mb-4">
          {t.whatsappWarning}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        {status === null ? (
          <p className="text-gray-400 text-sm">{t.loading}</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-gray-500">{t.subscriptionStatus}</span>
              {info && (
                <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full border ${color}`}>
                  {info.label}
                </span>
              )}
            </div>

            <p className="text-sm text-gray-500 mb-5">{info?.description}</p>

            <div className="flex flex-col gap-2">
              {status !== "active" && (
                <button
                  onClick={subscribe}
                  disabled={checkoutLoading}
                  className="w-full bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition"
                >
                  {checkoutLoading ? t.redirecting : status === "trial" ? t.subscribeNow : t.reactivate}
                </button>
              )}

              {(status === "active" || status === "past_due") && (
                <button
                  onClick={openPortal}
                  disabled={portalLoading}
                  className="w-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 text-sm font-semibold py-2.5 rounded-lg transition"
                >
                  {portalLoading ? t.redirecting : t.manageBilling}
                </button>
              )}
            </div>

            {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
          </>
        )}
      </div>

      <SavingsCalculator lang={lang} />
    </div>
  );
}
