"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";

interface BlockedTime {
  id: string;
  startTime: string;
  endTime: string;
  reason?: string | null;
}

export default function BlockedTimesPage() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [blocks, setBlocks] = useState<BlockedTime[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tz, setTz] = useState("Asia/Jerusalem");

  async function load() {
    setBlocks(await apiFetch<BlockedTime[]>("/api/business/blocked-times"));
  }

  useEffect(() => {
    apiFetch<{ timezone?: string }>("/api/business/me").then((me) => { if (me.timezone) setTz(me.timezone); }).catch(() => {});
    load().catch((e) => setError(e.message));
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/business/blocked-times", {
        method: "POST",
        body: JSON.stringify({ startTime: start, endTime: end, reason: reason || undefined }),
      });
      setStart(""); setEnd(""); setReason("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await apiFetch(`/api/business/blocked-times/${id}`, { method: "DELETE" });
    await load();
  }

  function fmt(iso: string) {
    return new Date(iso).toLocaleString(he ? "he-IL" : "en-US", {
      timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{he ? "חופשות וחסימות" : "Time off & blocks"}</h1>
        <p className="text-gray-500 text-sm mt-1">
          {he
            ? "חסום תאריכים ושעות שבהם הבוט לא יקבע תורים — חופשות, הפסקות או ימי חג."
            : "Block dates and times when the bot won't take bookings — vacations, breaks or holidays."}
        </p>
      </div>

      <form onSubmit={add} className="bg-white border border-gray-200 rounded-xl p-5 mb-6 flex flex-col gap-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">{he ? "מתחילת" : "From"}</label>
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required className="w-full" dir="ltr" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">{he ? "ועד" : "Until"}</label>
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required className="w-full" dir="ltr" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">{he ? "סיבה (רשות)" : "Reason (optional)"}</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={he ? "חופשה, הפסקת צהריים..." : "Vacation, lunch break..."} className="w-full" />
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className="inline-flex bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
            {saving ? "…" : (he ? "הוסף חסימה" : "Add block")}
          </button>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
      </form>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {blocks.length === 0 ? (
          <div className="px-6 py-10 text-center text-gray-400 text-sm">
            {he ? "אין חסימות מתוזמנות" : "No scheduled blocks"}
          </div>
        ) : (
          <ul>
            {blocks.map((b, i) => (
              <li key={b.id} className={`flex items-center justify-between px-5 py-3.5 ${i !== blocks.length - 1 ? "border-b border-gray-100" : ""}`}>
                <div>
                  <div className="text-sm font-medium text-gray-800">{fmt(b.startTime)} — {fmt(b.endTime)}</div>
                  {b.reason && <div className="text-xs text-gray-400 mt-0.5">{b.reason}</div>}
                </div>
                <button onClick={() => remove(b.id)} className="text-xs text-gray-400 hover:text-red-600 transition px-2 py-1 rounded">
                  {he ? "הסר" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
