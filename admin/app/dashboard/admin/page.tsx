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
  walletBalanceAgorot: number;
  messagesUsedThisCycle: number;
  _count: { appointments: number; customers: number };
}

// Must match MESSAGE_QUOTA_BY_PLAN in backend/src/lib/wallet.ts — display-only, not authoritative.
const MESSAGE_QUOTA_BY_PLAN: Record<string, number> = { standard: 300, premium: 1000 };

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

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
        {businesses === null ? (
          <div>{Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} cols={6} />)}</div>
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
                  <td className="px-4 py-3 text-gray-500 text-xs">{b.paymentProvider ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{b.invoiceProvider ?? "—"}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    <span className={`font-medium tabular-nums ${b.walletBalanceAgorot < 0 ? "text-red-600" : "text-gray-700"}`}>
                      ₪{(b.walletBalanceAgorot / 100).toFixed(2)}
                    </span>
                    <span className="text-gray-400 ms-1.5 tabular-nums">
                      · {b.messagesUsedThisCycle}/{MESSAGE_QUOTA_BY_PLAN[b.subscriptionPlan ?? ""] ?? MESSAGE_QUOTA_BY_PLAN.standard}
                    </span>
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
