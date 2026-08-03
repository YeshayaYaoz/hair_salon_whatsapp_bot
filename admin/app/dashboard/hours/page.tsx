"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SkeletonBlock } from "../../lib/Skeleton";
import { SavedBadge } from "../../lib/SavedBadge";
import { SpecialPeriods } from "../../lib/SpecialPeriods";
import { GoogleHoursSync } from "../../lib/GoogleHoursSync";
import { describeLocalInput, localeFor } from "../../lib/tz";

interface DayHours {
  dayOfWeek: number;
  open: string;
  close: string;
  enabled: boolean;
}

interface BlockedTime {
  id: string;
  startTime: string;
  endTime: string;
  reason?: string | null;
}

function BlockedTimesSection() {
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
    <div className="mt-8">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-gray-900">{he ? "חופשות וחסימות" : "Time off & blocks"}</h2>
        <p className="text-gray-600 text-sm mt-1">
          {he
            ? "חסום תאריכים ושעות שבהם הבוט לא יקבע תורים — חופשות, הפסקות או ימי חג."
            : "Block dates and times when the bot won't take bookings — vacations, breaks or holidays."}
        </p>
      </div>

      <form onSubmit={add} className="bg-white border border-gray-200 rounded-xl p-5 mb-4 flex flex-col gap-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">{he ? "מתחילת" : "From"}</label>
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required className="w-full" dir="ltr" />
            {describeLocalInput(start, localeFor(lang), true) && (
              <p className="text-[11px] font-medium text-[#145F78] mt-1">{describeLocalInput(start, localeFor(lang), true)}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">{he ? "ועד" : "Until"}</label>
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required className="w-full" dir="ltr" />
            {describeLocalInput(end, localeFor(lang), true) && (
              <p className="text-[11px] font-medium text-[#145F78] mt-1">{describeLocalInput(end, localeFor(lang), true)}</p>
            )}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">{he ? "סיבה (רשות)" : "Reason (optional)"}</label>
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
          <div className="px-6 py-10 text-center text-gray-600 text-sm">
            {he ? "אין חסימות מתוזמנות" : "No scheduled blocks"}
          </div>
        ) : (
          <ul>
            {blocks.map((b, i) => (
              <li key={b.id} className={`flex items-center justify-between px-5 py-3.5 ${i !== blocks.length - 1 ? "border-b border-gray-100" : ""}`}>
                <div>
                  <div className="text-sm font-medium text-gray-800">{fmt(b.startTime)} — {fmt(b.endTime)}</div>
                  {b.reason && <div className="text-xs text-gray-600 mt-0.5">{b.reason}</div>}
                </div>
                <button onClick={() => remove(b.id)} className="row-action text-xs text-gray-600 hover:text-red-600 transition px-2 py-1 rounded hover:bg-red-50">
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

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function toHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export default function HoursPage() {
  const { t, lang, businessType } = useLanguage();
  const [hours, setHours] = useState<DayHours[]>(
    t.days.map((_, i) => ({ dayOfWeek: i, open: "09:00", close: "18:00", enabled: i !== 6 }))
  );
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadHours = useCallback(() => {
    apiFetch<{ dayOfWeek: number; openMin: number; closeMin: number }[]>("/api/business/hours").then((existing) => {
      if (existing.length > 0) {
        setHours(
          t.days.map((_, i) => {
            const match = existing.find((h) => h.dayOfWeek === i);
            return match
              ? { dayOfWeek: i, open: toHHMM(match.openMin), close: toHHMM(match.closeMin), enabled: true }
              : { dayOfWeek: i, open: "09:00", close: "18:00", enabled: false };
          })
        );
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
    // t.days is only read for its length (7), which never changes, so this is stable across
    // language switches — re-running it on every render would refetch the hours on each keystroke.
  }, [t.days]);

  useEffect(() => { loadHours(); }, [loadHours]);

  async function save() {
    const payload = hours
      .filter((h) => h.enabled)
      .map((h) => ({ dayOfWeek: h.dayOfWeek, openMin: toMin(h.open), closeMin: toMin(h.close) }));
    await apiFetch("/api/business/hours", { method: "PUT", body: JSON.stringify(payload) });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function update(i: number, patch: Partial<DayHours>) {
    setHours((prev) => prev.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{t.hoursTitle}</h1>
        <p className="text-gray-600 text-sm mt-1">{t.hoursSubtitle}</p>
      </div>

      {/* An overnight rental has no daily opening hours to keep in sync — a guest checks in and
          stays the night — so importing a Google "open 09:00-18:00" week would be meaningless
          there. Same reasoning that hides this whole page from the B&B nav. */}
      {businessType !== "bnb" && <GoogleHoursSync onApplied={loadHours} />}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
        {!loaded ? (
          <div className="flex flex-col">
            {t.days.map((_, i) => (
              <div key={i} className={`flex items-center gap-4 px-5 py-3.5 ${i !== t.days.length - 1 ? "border-b border-gray-200/50" : ""}`}>
                <SkeletonBlock className="h-4 w-4 rounded" />
                <SkeletonBlock className="h-3.5 w-20" />
                <SkeletonBlock className="h-7 w-40 ms-auto rounded-md" />
              </div>
            ))}
          </div>
        ) : hours.map((h, i) => (
          <div
            key={h.dayOfWeek}
            className={`flex items-center gap-4 px-5 py-3.5 ${i !== hours.length - 1 ? "border-b border-gray-200/50" : ""} ${!h.enabled ? "opacity-50" : ""}`}
          >
            {/* Label wrapper, so the day name is part of the tap target — the native box is 16px,
                which is a small thing to hit with a thumb. */}
            <label className="row-action flex items-center gap-4 cursor-pointer -my-1 py-1">
              <input
                type="checkbox"
                checked={h.enabled}
                onChange={(e) => update(i, { enabled: e.target.checked })}
                aria-label={lang === "he" ? `פתוח ביום ${t.days[h.dayOfWeek]}` : `Open on ${t.days[h.dayOfWeek]}`}
              />
              <span className="w-24 text-sm font-medium text-gray-700">{t.days[h.dayOfWeek]}</span>
            </label>
            <div className="flex items-center gap-2 ms-auto" dir={lang === "he" ? "rtl" : "ltr"}>
              <label className="text-gray-600 text-xs">{lang === "he" ? "מ־" : "from"}</label>
              <input
                type="time"
                value={h.open}
                onChange={(e) => update(i, { open: e.target.value })}
                disabled={!h.enabled}
                className="text-sm py-1.5 px-2"
                dir="ltr"
                aria-label={lang === "he" ? `שעת פתיחה ביום ${t.days[h.dayOfWeek]}` : `Opening time on ${t.days[h.dayOfWeek]}`}
              />
              <span className="text-gray-600 text-sm">{t.to}</span>
              <input
                type="time"
                value={h.close}
                onChange={(e) => update(i, { close: e.target.value })}
                disabled={!h.enabled}
                className="text-sm py-1.5 px-2"
                dir="ltr"
                aria-label={lang === "he" ? `שעת סגירה ביום ${t.days[h.dayOfWeek]}` : `Closing time on ${t.days[h.dayOfWeek]}`}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          className="bg-[#1B7FA0] hover:bg-[#2A9BBF] text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
        >
          {t.saveHours}
        </button>
        {saved && <SavedBadge text={t.saved} />}
      </div>

      <BlockedTimesSection />
      <SpecialPeriods />
    </div>
  );
}
