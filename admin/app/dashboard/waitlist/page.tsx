"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { formatPhone } from "../../lib/formatPhone";

interface WaitlistEntry {
  id: string;
  notified: boolean;
  createdAt: string;
  customer: { name?: string; phone: string };
  service: { name: string };
}

export default function WaitlistPage() {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function load() {
    setEntries(await apiFetch<WaitlistEntry[]>("/api/business/waitlist"));
  }

  useEffect(() => { load(); }, []);

  async function markNotified(id: string) {
    setLoadingId(id);
    try {
      await apiFetch(`/api/business/waitlist/${id}/notify`, { method: "PATCH" });
      await load();
    } finally {
      setLoadingId(null);
    }
  }

  async function remove(id: string) {
    setLoadingId(id);
    try {
      await apiFetch(`/api/business/waitlist/${id}`, { method: "DELETE" });
      await load();
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
        <p className="text-gray-500 text-sm mt-1">{t.waitlistSubtitle}</p>
      </div>

      {entries.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-6 py-12 text-center text-gray-400 text-sm">
          {t.noWaitlist}
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="mb-6">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t.pendingWaitlist} — {pending.length}</h2>
              <div className="bg-white border border-gray-200 rounded-xl divide-y divide-zinc-800/60">
                {pending.map((e) => (
                  <div key={e.id} className="flex items-center justify-between px-4 py-3 gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#1B7FA0]/20 border border-[#145F78]/40 flex items-center justify-center text-[#5BB8D4] font-semibold text-sm shrink-0">
                        {(e.customer.name ?? e.customer.phone).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-gray-700 text-sm font-medium">{e.customer.name ?? <span className="text-gray-400 italic">—</span>}</div>
                        <div className="text-gray-400 text-xs"><span dir="ltr">{formatPhone(e.customer.phone)}</span> · {e.service.name}</div>
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
                        className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50 px-2 py-1.5 rounded-lg hover:bg-red-950/30 transition"
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
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t.notifiedWaitlist} — {notified.length}</h2>
              <div className="bg-white border border-gray-200 rounded-xl divide-y divide-zinc-800/60 opacity-60">
                {notified.map((e) => (
                  <div key={e.id} className="flex items-center justify-between px-4 py-3 gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 font-semibold text-sm shrink-0">
                        {(e.customer.name ?? e.customer.phone).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-gray-500 text-sm">{e.customer.name ?? <span dir="ltr">{formatPhone(e.customer.phone)}</span>}</div>
                        <div className="text-zinc-600 text-xs"><span dir="ltr">{formatPhone(e.customer.phone)}</span> · {e.service.name}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => remove(e.id)}
                      disabled={loadingId === e.id}
                      className="text-xs text-zinc-600 hover:text-red-600 disabled:opacity-50 px-2 py-1.5 rounded-lg hover:bg-red-950/30 transition"
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
