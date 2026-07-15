"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SkeletonRow } from "../../lib/Skeleton";

interface AdminBusiness {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  subscriptionStatus: string;
  subscriptionPlan: string | null;
  billingCycle: string;
  whatsappConnected: boolean;
  whatsappTokenValid: boolean;
  paymentProvider: string | null;
  invoiceProvider: string | null;
  depositEnabled: boolean;
  walletBalanceAgorot: number;
  messagesUsedThisCycle: number;
  _count: { appointments: number; customers: number };
}

// Must match MESSAGE_QUOTA_BY_PLAN in backend/src/lib/wallet.ts — display-only, not authoritative.
const MESSAGE_QUOTA_BY_PLAN: Record<string, number> = { standard: 300, premium: 1000 };
// Must match PLAN_PRICES_ILS in backend/src/billing/payplusSubscription.ts.
const PLAN_PRICES_ILS: Record<string, number> = { standard: 149, premium: 299 };
const ANNUAL_MONTHS_CHARGED = 10;

// --- Unit-economics placeholders (documented, not authoritative) ---
// Actual WhatsApp Business API conversation pricing varies by country/category (utility vs
// marketing vs service) and changes periodically; Claude API cost depends on token usage per
// conversation. These are rough per-business/month estimates for a directional margin view only
// — tune them once real invoiced costs are known. Keep in one place so it's a config edit later.
const EST_WHATSAPP_COST_ILS_PER_MSG = 0.15; // rough blended conversation cost, Israel utility-tier
const EST_CLAUDE_COST_ILS_PER_MSG = 0.08; // rough blended input+output tokens per bot reply
const EST_HOSTING_SHARE_ILS_PER_BIZ = 8; // Railway + Neon, spread across an assumed active fleet size

function estimatedMonthlyCostIls(messagesUsedThisCycle: number): number {
  const variableCost = messagesUsedThisCycle * (EST_WHATSAPP_COST_ILS_PER_MSG + EST_CLAUDE_COST_ILS_PER_MSG);
  return variableCost + EST_HOSTING_SHARE_ILS_PER_BIZ;
}

function monthlyRevenueIls(b: AdminBusiness): number {
  if (b.subscriptionStatus !== "active" || !b.subscriptionPlan) return 0;
  const base = PLAN_PRICES_ILS[b.subscriptionPlan] ?? 0;
  return b.billingCycle === "annual" ? (base * ANNUAL_MONTHS_CHARGED) / 12 : base;
}

const STATUS_COLORS: Record<string, string> = {
  trial: "bg-amber-50 text-amber-700 border-amber-200",
  active: "bg-green-50 text-green-700 border-green-200",
  past_due: "bg-red-50 text-red-600 border-red-200",
  canceled: "bg-gray-100 text-gray-500 border-gray-200",
};

export default function AdminBusinessesPage() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [businesses, setBusinesses] = useState<AdminBusiness[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    apiFetch<AdminBusiness[]>("/api/business/admin/businesses")
      .then(setBusinesses)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  const filtered = (businesses ?? []).filter(
    (b) => b.name.toLowerCase().includes(search.toLowerCase()) || b.email.toLowerCase().includes(search.toLowerCase())
  );

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString(he ? "he-IL" : "en-US", { day: "numeric", month: "short", year: "numeric" });
  }

  const all = businesses ?? [];
  const mrrIls = all.reduce((sum, b) => sum + monthlyRevenueIls(b), 0);
  const estCostIls = all.reduce((sum, b) => sum + estimatedMonthlyCostIls(b.messagesUsedThisCycle), 0);
  const marginIls = mrrIls - estCostIls;
  const counts = {
    trial: all.filter((b) => b.subscriptionStatus === "trial").length,
    active: all.filter((b) => b.subscriptionStatus === "active").length,
    pastDue: all.filter((b) => b.subscriptionStatus === "past_due").length,
    canceled: all.filter((b) => b.subscriptionStatus === "canceled").length,
  };
  const brokenWhatsapp = all.filter((b) => b.whatsappConnected && !b.whatsappTokenValid);
  const negativeWallet = all.filter((b) => b.walletBalanceAgorot < 0);
  const noPaymentConnected = all.filter((b) => !b.paymentProvider && b.subscriptionStatus !== "canceled");
  const attentionCount = counts.pastDue + brokenWhatsapp.length + negativeWallet.length;

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3 animate-fade-up">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{he ? "כל העסקים" : "All businesses"}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {businesses ? (he ? `${businesses.length} עסקים רשומים` : `${businesses.length} registered businesses`) : "…"}
          </p>
        </div>
        <input
          placeholder={he ? "חיפוש לפי שם או אימייל" : "Search by name or email"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>
      )}

      {businesses && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 animate-fade-up">
            <KpiCard
              label={he ? 'הכנסה חודשית (MRR)' : "MRR"}
              value={`₪${mrrIls.toLocaleString(he ? "he-IL" : "en-US", { maximumFractionDigits: 0 })}`}
              sub={he ? `${counts.active} עסקים פעילים` : `${counts.active} active`}
            />
            <KpiCard
              label={he ? "עלות משוערת/חודש" : "Est. cost/mo"}
              value={`₪${estCostIls.toLocaleString(he ? "he-IL" : "en-US", { maximumFractionDigits: 0 })}`}
              sub={he ? "WhatsApp + Claude + אחסון" : "WhatsApp + Claude + hosting"}
            />
            <KpiCard
              label={he ? "רווח גולמי משוער" : "Est. gross margin"}
              value={`₪${marginIls.toLocaleString(he ? "he-IL" : "en-US", { maximumFractionDigits: 0 })}`}
              sub={mrrIls > 0 ? `${Math.round((marginIls / mrrIls) * 100)}%` : "—"}
              tone={marginIls >= 0 ? "good" : "bad"}
            />
            <KpiCard
              label={he ? "בניסיון" : "In trial"}
              value={String(counts.trial)}
              sub={he ? `${counts.canceled} בוטלו` : `${counts.canceled} canceled`}
            />
          </div>

          {attentionCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 animate-fade-up text-sm">
              <div className="font-semibold text-amber-800 mb-1.5">
                {he ? `⚠️ ${attentionCount} עסקים דורשים תשומת לב` : `⚠️ ${attentionCount} businesses need attention`}
              </div>
              <ul className="text-amber-700 space-y-0.5 text-xs">
                {counts.pastDue > 0 && (
                  <li>{he ? `${counts.pastDue} בפיגור בתשלום — סיכון נטישה` : `${counts.pastDue} past due — churn risk`}</li>
                )}
                {brokenWhatsapp.length > 0 && (
                  <li>
                    {he ? `${brokenWhatsapp.length} עם חיבור WhatsApp שבור: ` : `${brokenWhatsapp.length} with broken WhatsApp: `}
                    {brokenWhatsapp.map((b) => b.name).join(", ")}
                  </li>
                )}
                {negativeWallet.length > 0 && (
                  <li>
                    {he ? `${negativeWallet.length} עם ארנק שלילי: ` : `${negativeWallet.length} with negative wallet: `}
                    {negativeWallet.map((b) => b.name).join(", ")}
                  </li>
                )}
                {noPaymentConnected.length > 0 && (
                  <li className="text-amber-600">
                    {he
                      ? `${noPaymentConnected.length} בלי סליקה מחוברת — לא יכולים להציע מקדמות`
                      : `${noPaymentConnected.length} without a payment provider connected — can't offer deposits`}
                  </li>
                )}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
        {businesses === null ? (
          <div>{Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} cols={10} />)}</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400 text-sm">{he ? "לא נמצאו עסקים" : "No businesses found"}</div>
        ) : (
          <table className="w-full text-sm min-w-[1020px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-start px-4 py-3 text-gray-500 font-medium">{he ? "עסק" : "Business"}</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">{he ? "נרשם" : "Joined"}</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">{he ? "מנוי" : "Subscription"}</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">WhatsApp</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">{he ? "סליקה" : "Payment"}</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">{he ? "חשבוניות" : "Invoicing"}</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">{he ? "ארנק / שימוש" : "Wallet / usage"}</th>
                <th className="text-end px-4 py-3 text-gray-500 font-medium">{he ? "רווח משוער/חודש" : "Est. margin/mo"}</th>
                <th className="text-end px-4 py-3 text-gray-500 font-medium">{he ? "תורים" : "Bookings"}</th>
                <th className="text-end px-4 py-3 text-gray-500 font-medium">{he ? "לקוחות" : "Customers"}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, i) => (
                <tr key={b.id} className={i !== filtered.length - 1 ? "border-b border-gray-200/50" : ""}>
                  <td className="px-4 py-3">
                    <div className="text-gray-800 font-medium">{b.name}</div>
                    <div className="text-gray-400 text-xs" dir="ltr">{b.email}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(b.createdAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full border ${STATUS_COLORS[b.subscriptionStatus] ?? ""}`}>
                      {b.subscriptionStatus}
                    </span>
                    {b.subscriptionPlan && (
                      <span className="ms-1.5 text-xs text-gray-400">
                        {b.subscriptionPlan}{b.billingCycle === "annual" ? " · annual" : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {b.whatsappConnected ? (
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${b.whatsappTokenValid ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-300"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${b.whatsappTokenValid ? "bg-green-400" : "bg-amber-400"}`} />
                        {b.whatsappTokenValid ? (he ? "מחובר" : "Connected") : (he ? "נותק" : "Broken")}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">{he ? "לא מחובר" : "Not connected"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {b.paymentProvider ?? "—"}
                    {b.depositEnabled && (
                      <span className="ms-1.5 inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                        {he ? "מקדמות" : "deposits"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{b.invoiceProvider ?? "—"}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    <span className={`font-medium tabular-nums ${b.walletBalanceAgorot < 0 ? "text-red-600" : "text-gray-700"}`}>
                      ₪{(b.walletBalanceAgorot / 100).toFixed(2)}
                    </span>
                    <span className="text-gray-400 ms-1.5 tabular-nums">
                      · {b.messagesUsedThisCycle}/{MESSAGE_QUOTA_BY_PLAN[b.subscriptionPlan ?? ""] ?? MESSAGE_QUOTA_BY_PLAN.standard}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums">
                    {(() => {
                      const margin = monthlyRevenueIls(b) - estimatedMonthlyCostIls(b.messagesUsedThisCycle);
                      return <span className={margin >= 0 ? "text-gray-700" : "text-red-600 font-medium"}>₪{margin.toFixed(0)}</span>;
                    })()}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-700">{b._count.appointments}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-700">{b._count.customers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "good" | "bad" }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3.5">
      <div className="text-xs text-gray-500 font-medium mb-1">{label}</div>
      <div
        className={`text-xl font-bold tabular-nums ${tone === "bad" ? "text-red-600" : tone === "good" ? "text-green-700" : "text-gray-900"}`}
      >
        {value}
      </div>
      <div className="text-xs text-gray-400 mt-0.5">{sub}</div>
    </div>
  );
}
