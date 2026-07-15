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
  // Real, metered figures from ApiUsageEvent — actual Anthropic token usage (costed from
  // Anthropic's own published rates) and actual billable WhatsApp messages, last 30 days. Not
  // estimates: a business with no bot activity in that window shows ₪0/0 here, which is correct.
  realClaudeCostAgorot30d: number;
  realClaudeTokens30d: number;
  realWhatsappBillableCount30d: number;
  _count: { appointments: number; customers: number };
}

interface PhoneUsageRow {
  customerPhone: string;
  claudeCostAgorot: number;
  claudeTokens: number;
  whatsappBillableCount: number;
  whatsappByCategory: Record<string, number>;
}

// Must match MESSAGE_QUOTA_BY_PLAN in backend/src/lib/wallet.ts — display-only, not authoritative.
const MESSAGE_QUOTA_BY_PLAN: Record<string, number> = { standard: 300, premium: 1000 };
// Must match PLAN_PRICES_ILS in backend/src/billing/payplusSubscription.ts.
const PLAN_PRICES_ILS: Record<string, number> = { standard: 149, premium: 299 };
const ANNUAL_MONTHS_CHARGED = 10;

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
  const [drilldown, setDrilldown] = useState<AdminBusiness | null>(null);
  const [phoneRows, setPhoneRows] = useState<PhoneUsageRow[] | null>(null);

  useEffect(() => {
    apiFetch<AdminBusiness[]>("/api/business/admin/businesses")
      .then(setBusinesses)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  useEffect(() => {
    if (!drilldown) return;
    setPhoneRows(null);
    apiFetch<PhoneUsageRow[]>(`/api/business/admin/usage-by-phone?businessId=${drilldown.id}`)
      .then(setPhoneRows)
      .catch(() => setPhoneRows([]));
  }, [drilldown]);

  const filtered = (businesses ?? []).filter(
    (b) => b.name.toLowerCase().includes(search.toLowerCase()) || b.email.toLowerCase().includes(search.toLowerCase())
  );

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString(he ? "he-IL" : "en-US", { day: "numeric", month: "short", year: "numeric" });
  }

  const all = businesses ?? [];
  const mrrIls = all.reduce((sum, b) => sum + monthlyRevenueIls(b), 0);
  // Real, metered — sum of actual ApiUsageEvent Claude costs across all businesses, last 30 days.
  const realClaudeCostIls30d = all.reduce((sum, b) => sum + b.realClaudeCostAgorot30d, 0) / 100;
  const realWhatsappBillable30d = all.reduce((sum, b) => sum + b.realWhatsappBillableCount30d, 0);
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
              label={he ? "עלות Claude בפועל (30 יום)" : "Real Claude cost (30d)"}
              value={`₪${realClaudeCostIls30d.toLocaleString(he ? "he-IL" : "en-US", { maximumFractionDigits: 2 })}`}
              sub={he ? "לפי טוקנים בפועל, לא הערכה" : "actual tokens, not estimated"}
            />
            <KpiCard
              label={he ? "הודעות WhatsApp חייבות (30 יום)" : "Billable WhatsApp msgs (30d)"}
              value={String(realWhatsappBillable30d)}
              sub={he ? "לפי Meta pricing status, בפועל" : "from Meta's own pricing status"}
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
                <th className="text-end px-4 py-3 text-gray-500 font-medium">{he ? "עלות Claude (30 יום)" : "Claude cost (30d)"}</th>
                <th className="text-end px-4 py-3 text-gray-500 font-medium">{he ? "תורים" : "Bookings"}</th>
                <th className="text-end px-4 py-3 text-gray-500 font-medium">{he ? "לקוחות" : "Customers"}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, i) => (
                <tr
                  key={b.id}
                  onClick={() => setDrilldown(b)}
                  className={`cursor-pointer hover:bg-gray-50 ${i !== filtered.length - 1 ? "border-b border-gray-200/50" : ""}`}
                >
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
                  <td className="px-4 py-3 text-end tabular-nums text-gray-700">
                    ₪{(b.realClaudeCostAgorot30d / 100).toFixed(2)}
                    <span className="text-gray-400 ms-1 text-xs">· {b.realClaudeTokens30d.toLocaleString()} tok</span>
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-700">{b._count.appointments}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-700">{b._count.customers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {drilldown && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setDrilldown(null)}
        >
          <div
            className="bg-white rounded-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-bold text-gray-900">{drilldown.name}</h2>
              <button onClick={() => setDrilldown(null)} className="text-gray-400 hover:text-gray-600 text-sm">
                {he ? "סגור" : "Close"}
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              {he ? "עלות בפועל, לפי מספר טלפון, 30 יום אחרונים" : "Real usage by phone number, last 30 days"}
            </p>
            {phoneRows === null ? (
              <div className="text-sm text-gray-400 py-6 text-center">…</div>
            ) : phoneRows.length === 0 ? (
              <div className="text-sm text-gray-400 py-6 text-center">
                {he ? "אין פעילות רשומה ב-30 הימים האחרונים" : "No recorded activity in the last 30 days"}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-start py-2 text-gray-500 font-medium">{he ? "טלפון" : "Phone"}</th>
                    <th className="text-end py-2 text-gray-500 font-medium">{he ? "עלות Claude" : "Claude cost"}</th>
                    <th className="text-end py-2 text-gray-500 font-medium">{he ? "טוקנים" : "Tokens"}</th>
                    <th className="text-end py-2 text-gray-500 font-medium">WhatsApp</th>
                  </tr>
                </thead>
                <tbody>
                  {phoneRows.map((r) => (
                    <tr key={r.customerPhone} className="border-b border-gray-100">
                      <td className="py-2 text-gray-800" dir="ltr">{r.customerPhone}</td>
                      <td className="py-2 text-end tabular-nums text-gray-700">₪{(r.claudeCostAgorot / 100).toFixed(2)}</td>
                      <td className="py-2 text-end tabular-nums text-gray-500">{r.claudeTokens.toLocaleString()}</td>
                      <td className="py-2 text-end tabular-nums text-gray-500">
                        {r.whatsappBillableCount > 0
                          ? `${r.whatsappBillableCount} (${Object.entries(r.whatsappByCategory).map(([c, n]) => `${c}:${n}`).join(", ")})`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
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
