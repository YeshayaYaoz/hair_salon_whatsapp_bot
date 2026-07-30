"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { EmptyState } from "../../lib/EmptyState";
import { formatPhone } from "../../lib/formatPhone";

interface WaitlistEntry {
  id: string;
  notified: boolean;
  createdAt: string;
  customer: { name?: string; phone: string };
  service: { name: string };
}

export default function WaitlistPage() {
  const { t, lang } = useLanguage();
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  // The mutations below previously used try/finally with no catch, so a failed notify/remove
  // cleared the spinner and did nothing else — the owner clicked and the row simply didn't change,
  // with no indication anything had gone wrong.
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setEntries(await apiFetch<WaitlistEntry[]>("/api/business/waitlist"));
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : lang === "he" ? "שגיאה בטעינה" : "Failed to load"));
  }, []);

  async function markNotified(id: string) {
    setLoadingId(id);
    setError(null);
    try {
      await apiFetch(`/api/business/waitlist/${id}/notify`, { method: "PATCH" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : lang === "he" ? "הפעולה נכשלה" : "Action failed");
    } finally {
      setLoadingId(null);
    }
  }

  async function remove(id: string) {
    setLoadingId(id);
    setError(null);
    try {
      await apiFetch(`/api/business/waitlist/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : lang === "he" ? "הפעולה נכשלה" : "Action failed");
    } finally {
      setLoadingId(null);
    }
  }

  const pending = entries.filter((e) => !e.notified);
  const notified = entries.filter((e) => e.notified);

  return (
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{t.waitlistTitle}</h1>
        <p className="text-gray-600 text-sm mt-1">{t.waitlistSubtitle}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 mb-4" role="alert">
          {error}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <EmptyState
            icon="⏳"
            title={t.noWaitlist}
            hint={lang === "he"
              ? "כשאין מקום פנוי, הבוט מציע ללקוח להצטרף לרשימת ההמתנה — ותראו אותו כאן."
              : "When no slot is free, the bot offers the customer a waitlist spot — they'll appear here."}
          />
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="mb-6">
              <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">{t.pendingWaitlist} — {pending.length}</h2>
              <div className="bg-white border border-gray-200 rounded-xl divide-y divide-zinc-800/60">
                {pending.map((e) => (
                  <div key={e.id} className="flex items-center justify-between px-4 py-3 gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#1B7FA0]/20 border border-[#145F78]/40 flex items-center justify-center text-[#5BB8D4] font-semibold text-sm shrink-0">
                        {(e.customer.name ?? e.customer.phone).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-gray-700 text-sm font-medium">{e.customer.name ?? <span className="text-gray-600 italic">—</span>}</div>
                        <div className="text-gray-600 text-xs"><span dir="ltr">{formatPhone(e.customer.phone)}</span> · {e.service.name}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-zinc-600 text-xs">{new Date(e.createdAt).toLocaleDateString()}</span>
                      <button
                        onClick={() => markNotified(e.id)}
                        disabled={loadingId === e.id}
                        className="text-xs bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white font-semibold px-3 py-1.5 rounded-lg transition"
                      >
                        {loadingId === e.id ? "…" : t.markNotified}
                      </button>
                      <button
                        onClick={() => remove(e.id)}
                        disabled={loadingId === e.id}
                        className="row-action text-xs text-gray-600 hover:text-red-600 disabled:opacity-50 px-2 py-1.5 rounded-lg hover:bg-red-50 transition"
                      >
                        {t.remove}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {notified.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">{t.notifiedWaitlist} — {notified.length}</h2>
              <div className="bg-white border border-gray-200 rounded-xl divide-y divide-zinc-800/60 opacity-60">
                {notified.map((e) => (
                  <div key={e.id} className="flex items-center justify-between px-4 py-3 gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-semibold text-sm shrink-0">
                        {(e.customer.name ?? e.customer.phone).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-gray-600 text-sm">{e.customer.name ?? <span dir="ltr">{formatPhone(e.customer.phone)}</span>}</div>
                        <div className="text-zinc-600 text-xs"><span dir="ltr">{formatPhone(e.customer.phone)}</span> · {e.service.name}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => remove(e.id)}
                      disabled={loadingId === e.id}
                      className="row-action text-xs text-gray-600 hover:text-red-600 disabled:opacity-50 px-2 py-1.5 rounded-lg hover:bg-red-50 transition"
                    >
                      {t.remove}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
