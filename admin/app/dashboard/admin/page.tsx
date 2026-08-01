"use client";

import { useEffect, useState } from "react";
import { apiFetch, startImpersonation } from "../../lib/api";
import { useRouter } from "next/navigation";
import { useLanguage } from "../../lib/LanguageContext";
import { SkeletonRow } from "../../lib/Skeleton";
import { useDialog } from "../../lib/useDialog";

interface AdminBusiness {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  notificationPhone: string | null;
  emailVerifiedAt: string | null;
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
  blockedAt: string | null;
  blockedReason: string | null;
  // Real, metered figures from ApiUsageEvent — actual Anthropic token usage (costed from
  // Anthropic's own published rates) and actual billable WhatsApp messages, last 30 days. Not
  // estimates: a business with no bot activity in that window shows ₪0/0 here, which is correct.
  realClaudeCostAgorot30d: number;
  realClaudeTokens30d: number;
  realWhatsappBillableCount30d: number;
  onboarding: { whatsapp: boolean; services: boolean; hours: boolean; payment: boolean };
  onboardingDone: number;
  onboardingTotal: number;
  _count: { appointments: number; customers: number };
}

interface PhoneUsageRow {
  customerPhone: string;
  claudeCostAgorot: number;
  claudeTokens: number;
  whatsappBillableCount: number;
  whatsappByCategory: Record<string, number>;
}

interface AuditLogEntry {
  id: string;
  actorEmail: string;
  action: string;
  targetBusinessId: string;
  targetBusinessName: string;
  details: string | null;
  createdAt: string;
}

interface MrrSnapshot {
  date: string;
  mrrIls: number;
  activeCount: number;
  trialCount: number;
  pastDueCount: number;
  canceledCount: number;
}

type StatusFilter = "all" | "trial" | "active" | "past_due" | "canceled" | "blocked" | "attention" | "onboarding";

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
  canceled: "bg-gray-100 text-gray-600 border-gray-200",
};

export default function AdminBusinessesPage() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const router = useRouter();
  const [businesses, setBusinesses] = useState<AdminBusiness[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [drilldown, setDrilldown] = useState<AdminBusiness | null>(null);
  const drilldownRef = useDialog<HTMLDivElement>(() => setDrilldown(null), drilldown !== null);
  const [phoneRows, setPhoneRows] = useState<PhoneUsageRow[] | null>(null);
  const [bizAuditLog, setBizAuditLog] = useState<AuditLogEntry[] | null>(null);
  const [blockReason, setBlockReason] = useState("");
  const [planChoice, setPlanChoice] = useState<"standard" | "premium">("standard");
  const [confirmDeleteName, setConfirmDeleteName] = useState("");
  const [messageText, setMessageText] = useState("");
  const [waPhoneId, setWaPhoneId] = useState("");
  const [waToken, setWaToken] = useState("");
  const [showWaForm, setShowWaForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [mrrHistory, setMrrHistory] = useState<MrrSnapshot[] | null>(null);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [globalAuditLog, setGlobalAuditLog] = useState<AuditLogEntry[] | null>(null);

  function reload() {
    return apiFetch<AdminBusiness[]>("/api/business/admin/businesses")
      .then(setBusinesses)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }

  useEffect(() => {
    reload();
    apiFetch<MrrSnapshot[]>("/api/business/admin/mrr-history").then(setMrrHistory).catch(() => setMrrHistory([]));
  }, []);

  function openDrilldown(b: AdminBusiness) {
    setDrilldown(b);
    setBlockReason("");
    setPlanChoice((b.subscriptionPlan as "standard" | "premium") ?? "standard");
    setConfirmDeleteName("");
    setMessageText("");
    setWaPhoneId("");
    setWaToken("");
    setShowWaForm(false);
    setActionError(null);
    setBizAuditLog(null);
    apiFetch<AuditLogEntry[]>(`/api/business/admin/audit-log?businessId=${b.id}`)
      .then(setBizAuditLog)
      .catch(() => setBizAuditLog([]));
  }

  async function runAction(fn: () => Promise<unknown>, keepOpen = false) {
    setActionBusy(true);
    setActionError(null);
    try {
      await fn();
      await reload();
      if (!keepOpen) setDrilldown(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed");
    } finally {
      setActionBusy(false);
    }
  }

  async function impersonate(b: AdminBusiness) {
    setActionBusy(true);
    setActionError(null);
    try {
      const { token } = await apiFetch<{ token: string }>(`/api/business/admin/businesses/${b.id}/impersonate`, { method: "POST" });
      startImpersonation(token);
      router.push("/dashboard/analytics");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed");
      setActionBusy(false);
    }
  }

  useEffect(() => {
    if (!drilldown) return;
    setPhoneRows(null);
    apiFetch<PhoneUsageRow[]>(`/api/business/admin/usage-by-phone?businessId=${drilldown.id}`)
      .then(setPhoneRows)
      .catch(() => setPhoneRows([]));
  }, [drilldown]);

  useEffect(() => {
    if (!showAuditLog || globalAuditLog) return;
    apiFetch<AuditLogEntry[]>("/api/business/admin/audit-log")
      .then(setGlobalAuditLog)
      .catch(() => setGlobalAuditLog([]));
  }, [showAuditLog, globalAuditLog]);

  const filtered = (businesses ?? [])
    .filter((b) => {
      const q = search.toLowerCase().trim();
      if (!q) return true;
      // Digits-only comparison for the phone so a search for "0501234567" still matches a stored
      // "+972-50-123-4567" — the operator types what they see on their own call log.
      const phoneDigits = (b.notificationPhone ?? "").replace(/\D/g, "");
      const qDigits = q.replace(/\D/g, "");
      return (
        b.name.toLowerCase().includes(q) ||
        b.email.toLowerCase().includes(q) ||
        (qDigits.length >= 3 && phoneDigits.includes(qDigits))
      );
    })
    .filter((b) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "blocked") return Boolean(b.blockedAt);
      if (statusFilter === "onboarding") return b.onboardingDone < b.onboardingTotal;
      if (statusFilter === "attention") {
        return b.subscriptionStatus === "past_due" || (b.whatsappConnected && !b.whatsappTokenValid) || b.walletBalanceAgorot < 0;
      }
      return b.subscriptionStatus === statusFilter;
    });

  function exportCsv() {
    const rows = businesses ?? [];
    const header = [
      "name", "email", "emailVerified", "ownerPhone", "createdAt", "subscriptionStatus", "subscriptionPlan", "billingCycle",
      "blocked", "whatsappConnected", "paymentProvider", "invoiceProvider", "walletBalanceIls",
      "claudeCost30dIls", "appointments", "customers",
    ];
    const lines = rows.map((b) =>
      [
        b.name, b.email, b.emailVerifiedAt ? "yes" : "no", b.notificationPhone ?? "", b.createdAt, b.subscriptionStatus, b.subscriptionPlan ?? "", b.billingCycle,
        b.blockedAt ? "yes" : "no", b.whatsappConnected ? "yes" : "no", b.paymentProvider ?? "", b.invoiceProvider ?? "",
        (b.walletBalanceAgorot / 100).toFixed(2), (b.realClaudeCostAgorot30d / 100).toFixed(2),
        b._count.appointments, b._count.customers,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tori-businesses-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
  // Businesses still mid-setup: not canceled, but haven't finished all onboarding steps yet.
  const incompleteSetup = all.filter((b) => b.subscriptionStatus !== "canceled" && b.onboardingDone < b.onboardingTotal);
  const attentionCount = counts.pastDue + brokenWhatsapp.length + negativeWallet.length;

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3 animate-fade-up">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{he ? "כל העסקים" : "All businesses"}</h1>
          <p className="text-gray-600 text-sm mt-1">
            {businesses ? (he ? `${businesses.length} עסקים רשומים` : `${businesses.length} registered businesses`) : "…"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="text-sm" aria-label="סינון לפי סטטוס מנוי">
            <option value="all">{he ? "כל הסטטוסים" : "All statuses"}</option>
            <option value="trial">{he ? "בניסיון" : "Trial"}</option>
            <option value="active">{he ? "פעיל" : "Active"}</option>
            <option value="past_due">{he ? "בפיגור" : "Past due"}</option>
            <option value="canceled">{he ? "בוטל" : "Canceled"}</option>
            <option value="blocked">{he ? "חסום" : "Blocked"}</option>
            <option value="onboarding">{he ? "הגדרה לא הושלמה" : "Incomplete setup"}</option>
            <option value="attention">{he ? "דורש תשומת לב" : "Needs attention"}</option>
          </select>
          <input
            placeholder={he ? "חיפוש לפי שם, אימייל או טלפון" : "Search by name, email or phone"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
          <button onClick={exportCsv} className="text-sm font-medium px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700">
            {he ? "⬇ ייצוא CSV" : "⬇ Export CSV"}
          </button>
          <button
            onClick={() => setShowAuditLog((v) => !v)}
            className="text-sm font-medium px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700"
          >
            {he ? "📋 יומן פעולות" : "📋 Audit log"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>
      )}

      {showAuditLog && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 animate-fade-up max-h-72 overflow-y-auto">
          <h2 className="text-sm font-semibold text-gray-800 mb-2">{he ? "פעולות אדמין אחרונות" : "Recent admin actions"}</h2>
          {globalAuditLog === null ? (
            <div className="text-xs text-gray-600 py-4 text-center">…</div>
          ) : globalAuditLog.length === 0 ? (
            <div className="text-xs text-gray-600 py-4 text-center">{he ? "אין פעולות עדיין" : "No actions yet"}</div>
          ) : (
            <ul className="text-xs text-gray-600 space-y-1.5">
              {globalAuditLog.map((entry) => (
                <li key={entry.id} className="flex items-center gap-2 flex-wrap">
                  <span className="text-gray-600 tabular-nums">{new Date(entry.createdAt).toLocaleString(he ? "he-IL" : "en-US")}</span>
                  <span className="font-semibold text-gray-800">{entry.action}</span>
                  <span>{entry.targetBusinessName}</span>
                  {entry.details && <span className="text-gray-600">— {entry.details}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mrrHistory && mrrHistory.length > 1 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 animate-fade-up">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">{he ? "מגמת MRR (יומי)" : "MRR trend (daily)"}</h2>
          <MrrSparkline snapshots={mrrHistory} he={he} />
        </div>
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

          <ProviderStatsPanel he={he} />

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
                {incompleteSetup.length > 0 && (
                  <li className="text-amber-600">
                    {he
                      ? `${incompleteSetup.length} לא סיימו את ההגדרה — שווה לדחוף`
                      : `${incompleteSetup.length} haven't finished setup — worth nudging`}
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
          <div className="px-6 py-12 text-center text-gray-600 text-sm">{he ? "לא נמצאו עסקים" : "No businesses found"}</div>
        ) : (
          <table className="w-full text-sm min-w-[1020px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-start px-4 py-3 text-gray-600 font-medium">{he ? "עסק" : "Business"}</th>
                <th className="text-start px-4 py-3 text-gray-600 font-medium">{he ? "יצירת קשר" : "Contact"}</th>
                <th className="text-start px-4 py-3 text-gray-600 font-medium">{he ? "נרשם" : "Joined"}</th>
                <th className="text-start px-4 py-3 text-gray-600 font-medium">{he ? "מנוי" : "Subscription"}</th>
                <th className="text-start px-4 py-3 text-gray-600 font-medium">WhatsApp</th>
                <th className="text-start px-4 py-3 text-gray-600 font-medium">{he ? "סליקה" : "Payment"}</th>
                <th className="text-start px-4 py-3 text-gray-600 font-medium">{he ? "חשבוניות" : "Invoicing"}</th>
                <th className="text-start px-4 py-3 text-gray-600 font-medium">{he ? "ארנק / שימוש" : "Wallet / usage"}</th>
                <th className="text-end px-4 py-3 text-gray-600 font-medium">{he ? "עלות Claude (30 יום)" : "Claude cost (30d)"}</th>
                <th className="text-end px-4 py-3 text-gray-600 font-medium">{he ? "תורים" : "Bookings"}</th>
                <th className="text-end px-4 py-3 text-gray-600 font-medium">{he ? "לקוחות" : "Customers"}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, i) => (
                <tr
                  key={b.id}
                  onClick={() => openDrilldown(b)}
                  className={`cursor-pointer hover:bg-gray-50 ${b.blockedAt ? "bg-red-50/40" : ""} ${i !== filtered.length - 1 ? "border-b border-gray-200/50" : ""}`}
                >
                  <td className="px-4 py-3">
                    <div className="text-gray-800 font-medium flex items-center gap-1.5">
                      {b.name}
                      {b.blockedAt && (
                        <span className="inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                          {he ? "חסום" : "blocked"}
                        </span>
                      )}
                    </div>
                    <div className="text-gray-600 text-xs flex items-center gap-1" dir="ltr">
                      {b.email}
                      {/* An unverified address means email outreach silently never lands, so it's
                          flagged right next to the address rather than in a separate column. */}
                      {!b.emailVerifiedAt && (
                        <span title={he ? "האימייל לא אומת — הודעות אליו עלולות לא להגיע" : "Email unverified — messages may not arrive"} className="text-amber-600">⚠</span>
                      )}
                    </div>
                  </td>
                  {/* Contact: stopPropagation so tapping a phone link dials instead of opening the
                      row's drill-down, which would swallow the tap. */}
                  <td className="px-4 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {b.notificationPhone ? (
                      <div className="flex items-center gap-2" dir="ltr">
                        <a
                          href={`tel:${b.notificationPhone}`}
                          className="text-[#1B7FA0] hover:underline tabular-nums text-xs font-medium"
                        >
                          {b.notificationPhone}
                        </a>
                        <a
                          href={`https://wa.me/${b.notificationPhone.replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={he ? "פתיחת וואטסאפ" : "Open WhatsApp"}
                          title={he ? "פתיחת וואטסאפ" : "Open WhatsApp"}
                          className="text-green-600 hover:text-green-700 text-sm leading-none"
                        >
                          ⌾
                        </a>
                      </div>
                    ) : (
                      <span
                        className="text-xs text-amber-700"
                        title={he ? "לא הוגדר מספר — אין דרך להתקשר, וגם ההתראות שלו לא עובדות" : "No phone set — no way to call, and their own alerts don't work either"}
                      >
                        {he ? "אין מספר" : "no phone"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(b.createdAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full border ${STATUS_COLORS[b.subscriptionStatus] ?? ""}`}>
                      {b.subscriptionStatus}
                    </span>
                    {b.subscriptionPlan && (
                      <span className="ms-1.5 text-xs text-gray-600">
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
                      <span className="text-xs text-gray-600">{he ? "לא מחובר" : "Not connected"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {b.paymentProvider ?? "—"}
                    {b.depositEnabled && (
                      <span className="ms-1.5 inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                        {he ? "מקדמות" : "deposits"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{b.invoiceProvider ?? "—"}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    <span className={`font-medium tabular-nums ${b.walletBalanceAgorot < 0 ? "text-red-600" : "text-gray-700"}`}>
                      ₪{(b.walletBalanceAgorot / 100).toFixed(2)}
                    </span>
                    <span className="text-gray-600 ms-1.5 tabular-nums">
                      · {b.messagesUsedThisCycle}/{MESSAGE_QUOTA_BY_PLAN[b.subscriptionPlan ?? ""] ?? MESSAGE_QUOTA_BY_PLAN.standard}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-700">
                    ₪{(b.realClaudeCostAgorot30d / 100).toFixed(2)}
                    <span className="text-gray-600 ms-1 text-xs">· {b.realClaudeTokens30d.toLocaleString()} tok</span>
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
            ref={drilldownRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="drilldown-title"
            className="bg-white rounded-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="min-w-0">
                <h2 id="drilldown-title" className="text-lg font-bold text-gray-900">{drilldown.name}</h2>
                {/* Reachability up top: the whole point of this panel is diagnosing a business and
                    then actually contacting the owner about it. hover:text-gray-900 because the
                    Close button's hover previously matched its base colour. */}
                <div className="flex items-center gap-3 mt-1 text-xs flex-wrap" dir="ltr">
                  <span className="text-gray-600">{drilldown.email}</span>
                  {drilldown.notificationPhone ? (
                    <>
                      <a href={`tel:${drilldown.notificationPhone}`} className="text-[#1B7FA0] hover:underline font-medium tabular-nums">
                        📞 {drilldown.notificationPhone}
                      </a>
                      <a
                        href={`https://wa.me/${drilldown.notificationPhone.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-green-600 hover:underline font-medium"
                      >
                        WhatsApp
                      </a>
                    </>
                  ) : (
                    <span className="text-amber-700">{he ? "לא הוגדר מספר טלפון" : "No phone number set"}</span>
                  )}
                </div>
              </div>
              <button onClick={() => setDrilldown(null)} className="text-gray-600 hover:text-gray-900 text-sm shrink-0">
                {he ? "סגור" : "Close"}
              </button>
            </div>

            {/* --- Onboarding checklist --- */}
            <div className="mb-4 mt-2">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-semibold text-gray-700">
                  {he ? "הגדרה" : "Setup"} — {drilldown.onboardingDone}/{drilldown.onboardingTotal}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${drilldown.onboardingDone === drilldown.onboardingTotal ? "bg-green-500" : "bg-amber-400"}`}
                    style={{ width: `${(drilldown.onboardingDone / drilldown.onboardingTotal) * 100}%` }}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {([
                  ["whatsapp", "WhatsApp"],
                  ["services", he ? "שירותים" : "Services"],
                  ["hours", he ? "שעות" : "Hours"],
                  ["payment", he ? "סליקה" : "Payment"],
                ] as const).map(([key, label]) => {
                  const done = drilldown.onboarding[key];
                  return (
                    <span
                      key={key}
                      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${done ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-600 border-gray-200"}`}
                    >
                      {done ? "✓" : "○"} {label}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* --- Admin actions --- */}
            <div className="border border-gray-200 rounded-lg p-3.5 mb-4 space-y-3">
              {actionError && <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-3 py-2">{actionError}</div>}

              {/* Impersonate + send message */}
              <div className="flex items-center gap-2">
                <button
                  disabled={actionBusy}
                  onClick={() => impersonate(drilldown)}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 disabled:opacity-50"
                >
                  {he ? "👁️ צפה כעסק זה" : "👁️ View as this business"}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  placeholder={he ? "הודעה לעסק (WhatsApp אם מחובר, אחרת מייל)" : "Message to business (WhatsApp if connected, else email)"}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  className="flex-1 text-xs"
                />
                <button
                  disabled={actionBusy || !messageText.trim()}
                  onClick={() =>
                    runAction(
                      () =>
                        apiFetch(`/api/business/admin/businesses/${drilldown.id}/message`, {
                          method: "POST",
                          body: JSON.stringify({ text: messageText }),
                        }),
                      true
                    ).then(() => setMessageText(""))
                  }
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap"
                >
                  {he ? "שלח" : "Send"}
                </button>
              </div>

              {/* White-glove WhatsApp connect (for salons with no Facebook account) */}
              <div className="pt-2 border-t border-gray-100">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-600">
                    {he ? "וואטסאפ" : "WhatsApp"}:{" "}
                    <span className={drilldown.whatsappConnected ? "text-green-600 font-medium" : "text-gray-600"}>
                      {drilldown.whatsappConnected
                        ? (drilldown.whatsappTokenValid ? (he ? "מחובר" : "connected") : (he ? "נותק" : "broken"))
                        : (he ? "לא מחובר" : "not connected")}
                    </span>
                  </span>
                  <button
                    onClick={() => setShowWaForm((v) => !v)}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
                  >
                    {showWaForm ? (he ? "סגור" : "Close") : (he ? "חבר עבורם" : "Connect for them")}
                  </button>
                </div>
                {showWaForm && (
                  <div className="flex flex-col gap-2 mt-2">
                    <p className="text-[11px] text-gray-600">
                      {he
                        ? "לעסק ללא פייסבוק: רשום את המספר שלו תחת ה-Business Manager שלך במטא, והדבק כאן את מזהה המספר והטוקן הקבוע."
                        : "For a business with no Facebook: register their number under your own Meta Business Manager, then paste its Phone Number ID and a permanent token here."}
                    </p>
                    <input placeholder="Phone Number ID" dir="ltr" value={waPhoneId} onChange={(e) => setWaPhoneId(e.target.value)} className="text-xs" />
                    <input placeholder={he ? "טוקן גישה קבוע" : "Permanent access token"} dir="ltr" value={waToken} onChange={(e) => setWaToken(e.target.value)} className="text-xs" />
                    <button
                      disabled={actionBusy || !waPhoneId.trim() || !waToken.trim()}
                      onClick={() =>
                        runAction(() =>
                          apiFetch(`/api/business/admin/businesses/${drilldown.id}/whatsapp`, {
                            method: "POST",
                            body: JSON.stringify({ phoneNumberId: waPhoneId, accessToken: waToken }),
                          })
                        )
                      }
                      className="text-xs font-medium px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 self-start"
                    >
                      {actionBusy ? (he ? "מאמת…" : "Verifying…") : (he ? "אמת וחבר" : "Verify & connect")}
                    </button>
                  </div>
                )}
              </div>

              {/* Block / unblock */}
              {drilldown.blockedAt ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-gray-600">
                    {he ? "חסום" : "Blocked"}{drilldown.blockedReason ? `: ${drilldown.blockedReason}` : ""}
                  </div>
                  <button
                    disabled={actionBusy}
                    onClick={() =>
                      runAction(() => apiFetch(`/api/business/admin/businesses/${drilldown.id}/unblock`, { method: "POST" }))
                    }
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 disabled:opacity-50"
                  >
                    {he ? "בטל חסימה" : "Unblock"}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    placeholder={he ? "סיבת חסימה (לא חובה)" : "Block reason (optional)"}
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                    className="flex-1 text-xs"
                  />
                  <button
                    disabled={actionBusy}
                    onClick={() =>
                      runAction(() =>
                        apiFetch(`/api/business/admin/businesses/${drilldown.id}/block`, {
                          method: "POST",
                          body: JSON.stringify({ reason: blockReason || undefined }),
                        })
                      )
                    }
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 whitespace-nowrap"
                  >
                    {he ? "חסום עסק" : "Block business"}
                  </button>
                </div>
              )}

              {/* Plan upgrade/downgrade */}
              <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                <select
                  value={planChoice}
                  onChange={(e) => setPlanChoice(e.target.value as "standard" | "premium")}
                  className="text-xs flex-1"
                >
                  <option value="standard">{he ? "סטנדרט" : "Standard"} (₪{PLAN_PRICES_ILS.standard})</option>
                  <option value="premium">{he ? "פרימיום" : "Premium"} (₪{PLAN_PRICES_ILS.premium})</option>
                </select>
                <button
                  disabled={actionBusy}
                  onClick={() =>
                    runAction(() =>
                      apiFetch(`/api/business/admin/businesses/${drilldown.id}/plan`, {
                        method: "POST",
                        body: JSON.stringify({ plan: planChoice }),
                      })
                    )
                  }
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 disabled:opacity-50 whitespace-nowrap"
                >
                  {he ? "קבע מנוי" : "Set plan"}
                </button>
              </div>

              {/* Permanent delete */}
              <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                <input
                  placeholder={he ? `הקלד "${drilldown.name}" לאישור מחיקה` : `Type "${drilldown.name}" to confirm delete`}
                  value={confirmDeleteName}
                  onChange={(e) => setConfirmDeleteName(e.target.value)}
                  className="flex-1 text-xs"
                />
                <button
                  disabled={actionBusy || confirmDeleteName.trim() !== drilldown.name}
                  onClick={() =>
                    runAction(() =>
                      apiFetch(`/api/business/admin/businesses/${drilldown.id}`, {
                        method: "DELETE",
                        body: JSON.stringify({ confirmName: confirmDeleteName }),
                      })
                    )
                  }
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {he ? "מחק לצמיתות" : "Delete permanently"}
                </button>
              </div>
            </div>

            {bizAuditLog && bizAuditLog.length > 0 && (
              <div className="mb-4">
                <h3 className="text-xs font-semibold text-gray-700 mb-1.5">{he ? "היסטוריית פעולות אדמין" : "Admin action history"}</h3>
                <ul className="text-xs text-gray-600 space-y-1">
                  {bizAuditLog.map((entry) => (
                    <li key={entry.id}>
                      <span className="tabular-nums text-gray-600">{new Date(entry.createdAt).toLocaleString(he ? "he-IL" : "en-US")}</span>
                      {" · "}
                      <span className="font-medium text-gray-700">{entry.action}</span>
                      {entry.details && <span> — {entry.details}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-gray-600 mb-4">
              {he ? "עלות בפועל, לפי מספר טלפון, 30 יום אחרונים" : "Real usage by phone number, last 30 days"}
            </p>
            {phoneRows === null ? (
              <div className="text-sm text-gray-600 py-6 text-center">…</div>
            ) : phoneRows.length === 0 ? (
              <div className="text-sm text-gray-600 py-6 text-center">
                {he ? "אין פעילות רשומה ב-30 הימים האחרונים" : "No recorded activity in the last 30 days"}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-start py-2 text-gray-600 font-medium">{he ? "טלפון" : "Phone"}</th>
                    <th className="text-end py-2 text-gray-600 font-medium">{he ? "עלות Claude" : "Claude cost"}</th>
                    <th className="text-end py-2 text-gray-600 font-medium">{he ? "טוקנים" : "Tokens"}</th>
                    <th className="text-end py-2 text-gray-600 font-medium">WhatsApp</th>
                  </tr>
                </thead>
                <tbody>
                  {phoneRows.map((r) => (
                    <tr key={r.customerPhone} className="border-b border-gray-100">
                      <td className="py-2 text-gray-800" dir="ltr">{r.customerPhone}</td>
                      <td className="py-2 text-end tabular-nums text-gray-700">₪{(r.claudeCostAgorot / 100).toFixed(2)}</td>
                      <td className="py-2 text-end tabular-nums text-gray-600">{r.claudeTokens.toLocaleString()}</td>
                      <td className="py-2 text-end tabular-nums text-gray-600">
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

interface ProviderStatRow {
  provider: string;
  model: string;
  calls: number;
  businesses: number;
  inputTokens: number;
  outputTokens: number;
  costAgorot: number;
  unpricedCalls: number;
  avgCostAgorotPerCall: number;
  avgOutputTokensPerCall: number;
  cacheHitRate: number | null;
}

/**
 * Head-to-head AI provider comparison from real production usage — the basis for deciding whether
 * a provider switch is actually worth it, instead of relying on vendor list prices.
 *
 * Two columns carry most of the signal: cost-per-call is the directly comparable commercial
 * number, and cache-hit rate is the health check on prompt caching (a large system prompt with a
 * low hit rate means caching silently isn't engaging, which makes every call full-price).
 */
function ProviderStatsPanel({ he }: { he: boolean }) {
  const [rows, setRows] = useState<ProviderStatRow[] | null>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    apiFetch<{ rows: ProviderStatRow[] }>(`/api/business/admin/provider-stats?days=${days}`)
      .then((r) => setRows(r.rows))
      .catch((e) => setError(e instanceof Error ? e.message : "שגיאה"));
  }, [days]);

  const totalCost = rows?.reduce((s, r) => s + r.costAgorot, 0) ?? 0;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{he ? "השוואת ספקי AI" : "AI provider comparison"}</h2>
          <p className="text-xs text-gray-600 mt-0.5">
            {he
              ? "נתוני שימוש אמיתיים — כל שורה היא קריאות API שבוצעו בפועל, לא הערכה."
              : "Real usage — every row is API calls actually made, not an estimate."}
          </p>
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="text-sm" aria-label="טווח ימים">
          <option value={7}>{he ? "7 ימים" : "7 days"}</option>
          <option value={30}>{he ? "30 ימים" : "30 days"}</option>
          <option value={90}>{he ? "90 ימים" : "90 days"}</option>
        </select>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-3 py-2 mt-3">{error}</div>}

      {rows === null ? (
        <p className="text-xs text-gray-600 mt-4">…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-600 mt-4">
          {he ? "אין עדיין נתוני שימוש בטווח הזה." : "No usage recorded in this range yet."}
        </p>
      ) : (
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-start px-2 py-2 text-gray-600 font-medium">{he ? "ספק / מודל" : "Provider / model"}</th>
                <th className="text-end px-2 py-2 text-gray-600 font-medium">{he ? "קריאות" : "Calls"}</th>
                <th className="text-end px-2 py-2 text-gray-600 font-medium">{he ? "עסקים" : "Businesses"}</th>
                <th className="text-end px-2 py-2 text-gray-600 font-medium">{he ? "עלות" : "Cost"}</th>
                <th className="text-end px-2 py-2 text-gray-600 font-medium">{he ? "לקריאה" : "Per call"}</th>
                <th className="text-end px-2 py-2 text-gray-600 font-medium">{he ? "מטמון" : "Cache hit"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.provider}|${r.model}`} className="border-b border-gray-100 last:border-0">
                  <td className="px-2 py-2.5">
                    <div className="font-medium text-gray-800">{r.provider}</div>
                    <div className="text-xs text-gray-600" dir="ltr">{r.model}</div>
                  </td>
                  <td className="px-2 py-2.5 text-end tabular-nums text-gray-700">{r.calls.toLocaleString()}</td>
                  <td className="px-2 py-2.5 text-end tabular-nums text-gray-700">{r.businesses}</td>
                  <td className="px-2 py-2.5 text-end tabular-nums text-gray-700">
                    ₪{(r.costAgorot / 100).toFixed(2)}
                    {r.unpricedCalls > 0 && (
                      <div className="text-[11px] text-amber-700" title={he ? "אין מחירון למודל הזה — העלות בפועל גבוהה יותר" : "No price on file for this model — real cost is higher"}>
                        {he ? `${r.unpricedCalls} ללא תמחור` : `${r.unpricedCalls} unpriced`}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-end tabular-nums font-medium text-gray-800">
                    {(r.avgCostAgorotPerCall).toFixed(2)}{he ? " אג׳" : "ag"}
                  </td>
                  <td className="px-2 py-2.5 text-end tabular-nums">
                    {r.cacheHitRate === null ? (
                      <span className="text-gray-600">—</span>
                    ) : (
                      <span className={r.cacheHitRate < 0.3 ? "text-amber-700 font-medium" : "text-green-700"}>
                        {Math.round(r.cacheHitRate * 100)}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-600 mt-3">
            {he ? `סה"כ ${(totalCost / 100).toFixed(2)} ₪ בטווח הנבחר.` : `₪${(totalCost / 100).toFixed(2)} total over the selected range.`}
            {" "}
            {he
              ? "מטמון נמוך (מתחת ל-30%) על פרומפט גדול מרמז שהמטמון לא נתפס — כל קריאה משלמת מחיר מלא."
              : "A low cache hit rate (under 30%) on a large prompt suggests caching isn't engaging — every call pays full price."}
          </p>
        </div>
      )}
    </div>
  );
}

function MrrSparkline({ snapshots, he }: { snapshots: MrrSnapshot[]; he: boolean }) {
  const width = 720;
  const height = 90;
  const pad = 4;
  const max = Math.max(...snapshots.map((s) => s.mrrIls), 1);
  const min = Math.min(...snapshots.map((s) => s.mrrIls), 0);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / Math.max(snapshots.length - 1, 1);

  const points = snapshots.map((s, i) => {
    const x = pad + i * stepX;
    const y = height - pad - ((s.mrrIls - min) / range) * (height - pad * 2);
    return { x, y, s };
  });
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${points[points.length - 1].x.toFixed(1)},${height - pad} L${points[0].x.toFixed(1)},${height - pad} Z`;
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const deltaPct = first.mrrIls > 0 ? Math.round(((last.mrrIls - first.mrrIls) / first.mrrIls) * 100) : 0;

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-lg font-bold text-gray-900 tabular-nums">₪{last.mrrIls.toLocaleString()}</span>
        <span className={`text-xs font-semibold ${deltaPct >= 0 ? "text-green-600" : "text-red-600"}`}>
          {deltaPct >= 0 ? "▲" : "▼"} {Math.abs(deltaPct)}% {he ? `לאורך ${snapshots.length} ימים` : `over ${snapshots.length}d`}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-24" preserveAspectRatio="none">
        <path d={areaD} fill="#1B7FA0" opacity="0.08" />
        <path d={pathD} fill="none" stroke="#1B7FA0" strokeWidth="2" />
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill="#1B7FA0" />
      </svg>
    </div>
  );
}

function KpiCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "good" | "bad" }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3.5">
      <div className="text-xs text-gray-600 font-medium mb-1">{label}</div>
      <div
        className={`text-xl font-bold tabular-nums ${tone === "bad" ? "text-red-600" : tone === "good" ? "text-green-700" : "text-gray-900"}`}
      >
        {value}
      </div>
      <div className="text-xs text-gray-600 mt-0.5">{sub}</div>
    </div>
  );
}
