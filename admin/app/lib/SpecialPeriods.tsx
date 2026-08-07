"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { useLanguage } from "./LanguageContext";

export interface SpecialPeriod {
  id: string;
  label: string;
  description: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

interface Suggested {
  kind: string;
  label: string;
  startDate: string;
  endDate: string;
}

/**
 * Dates on which the business runs on different terms — holiday pricing, a minimum stay, a
 * different menu. Deliberately separate from "time off": those close the calendar, these don't.
 * The business is open; only the terms change, and the bot's job is to say so before quoting.
 *
 * The dates are the hard part. Almost every rule an Israeli business has is anchored to the Hebrew
 * calendar ("כל ערב חג", "בין הזמנים", "חול המועד"), which no owner wants to look up and type in
 * twenty times a year. So the owner describes the period in their own words, the server resolves it
 * against a real Hebrew calendar, and the resulting dates are shown for review before anything is
 * saved — the owner confirms real dates, never a promise that the app worked it out correctly.
 */
export function SpecialPeriods() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const thisYear = new Date().getFullYear();

  const [periods, setPeriods] = useState<SpecialPeriod[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [description, setDescription] = useState("");
  const [year, setYear] = useState(thisYear);
  const [suggested, setSuggested] = useState<Suggested[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Manual entry, for anything that isn't a calendar period at all (a local festival, a wedding
  // season, a week the owner simply knows about).
  const [manualStart, setManualStart] = useState("");
  const [manualEnd, setManualEnd] = useState("");

  async function load() {
    setPeriods(await apiFetch<SpecialPeriod[]>("/api/business/special-periods"));
    setLoaded(true);
  }

  useEffect(() => {
    load().catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      setLoaded(true);
    });
  }, []);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setSearching(true);
    setError(null);
    setNotice(null);
    setSuggested(null);
    try {
      const res = await apiFetch<{ periods: Suggested[]; unmatched: boolean }>("/api/business/special-periods/suggest", {
        method: "POST",
        body: JSON.stringify({ text: query, year }),
      });
      if (res.periods.length === 0) {
        setNotice(
          he
            ? "לא זיהיתי תקופה מוכרת בטקסט. אפשר לנסח אחרת (למשל „ערב חג”, „בין הזמנים”, „חול המועד”) או להוסיף תאריכים ידנית למטה."
            : "Couldn't recognise a known period. Try different wording, or add the dates manually below."
        );
      }
      setSuggested(res.periods);
      // Everything found is pre-selected: the common case is "yes, all of them".
      setChosen(new Set(res.periods.map((p) => `${p.startDate}|${p.endDate}`)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  async function saveSuggested() {
    if (!suggested) return;
    const picked = suggested.filter((p) => chosen.has(`${p.startDate}|${p.endDate}`));
    if (picked.length === 0 || !description.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/business/special-periods", {
        method: "POST",
        body: JSON.stringify({
          periods: picked.map((p) => ({
            label: p.label,
            description: description.trim(),
            startDate: p.startDate,
            endDate: p.endDate,
          })),
        }),
      });
      setSuggested(null);
      setQuery("");
      setDescription("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    if (!manualStart || !description.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/business/special-periods", {
        method: "POST",
        body: JSON.stringify({
          periods: [
            {
              label: query.trim() || (he ? "תקופה מיוחדת" : "Special period"),
              description: description.trim(),
              startDate: manualStart,
              endDate: manualEnd || manualStart,
            },
          ],
        }),
      });
      setManualStart(""); setManualEnd(""); setDescription(""); setQuery("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await apiFetch(`/api/business/special-periods/${id}`, { method: "DELETE" });
    await load();
  }

  function fmtRange(start: string, end: string) {
    const f = (iso: string) => {
      const [y, m, d] = iso.split("-");
      return `${Number(d)}.${Number(m)}.${y}`;
    };
    return start === end ? f(start) : `${f(start)} – ${f(end)}`;
  }

  function toggle(key: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const examples = he
    ? ["כל ערב חג", "בין הזמנים", "חול המועד סוכות", "חופש גדול"]
    : ["Every erev chag", "Bein hazmanim", "Chol hamoed Sukkot", "Summer vacation"];

  return (
    <section className="mt-8">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-gray-900">{he ? "תאריכים מיוחדים" : "Special dates"}</h2>
        <p className="text-gray-600 text-sm mt-1">
          {he
            ? "תאריכים שבהם התנאים שונים מהרגיל — מחיר, מינימום לילות, שעות. העסק פתוח; רק התנאים משתנים, והבוט יגיד את זה ללקוח לפני שינקוב במחיר."
            : "Dates when your terms differ — pricing, minimum stay, hours. You stay open; only the terms change, and the bot tells customers before quoting anything."}
        </p>
      </div>

      <form onSubmit={search} className="bg-white border border-gray-200 rounded-xl p-5 mb-4 flex flex-col gap-3">
        <div>
          <label htmlFor="sp-query" className="block text-xs font-medium text-gray-600 mb-1.5">
            {he ? "מתי? תאר במילים שלך" : "When? Describe it in your own words"}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="sp-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={he ? "למשל: כל ערב חג" : "e.g. every erev chag"}
              className="flex-1 min-w-48"
              required
            />
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              aria-label={he ? "שנה" : "Year"}
              className="w-28"
            >
              {[thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={searching}
              className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
            >
              {searching ? "…" : he ? "מצא תאריכים" : "Find dates"}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setQuery(ex)}
                className="text-xs text-[#197492] bg-[#E0F5FB] hover:bg-[#c9edf7] px-2.5 py-1 rounded-full transition"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="sp-desc" className="block text-xs font-medium text-gray-600 mb-1.5">
            {he ? "מה משתנה בתאריכים האלה?" : "What changes on these dates?"}
          </label>
          <input
            id="sp-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={he ? "למשל: המחיר כפול, מינימום 3 לילות" : "e.g. double price, 3-night minimum"}
            className="w-full"
          />
          <p className="text-xs text-gray-600 mt-1.5">
            {he
              ? "הבוט מוסר את המשפט הזה כמו שהוא ולא מחשב מחיר בעצמו — הסכום המדויק תמיד נסגר מולך."
              : "The bot repeats this as written and never works out a new price itself — the exact amount is always settled with you."}
          </p>
        </div>

        {notice && <p className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{notice}</p>}
        {error && <p className="text-red-600 text-sm">{error}</p>}
      </form>

      {suggested && suggested.length > 0 && (
        <div className="bg-white border border-[#1B7FA0]/30 rounded-xl p-5 mb-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">
            {he ? `נמצאו ${suggested.length} תאריכים ב-${year}` : `Found ${suggested.length} dates in ${year}`}
          </h3>
          <p className="text-xs text-gray-600 mb-3">
            {he ? "בדוק ואשר. אפשר לבטל סימון של תאריך שלא רלוונטי." : "Review and confirm. Untick anything that doesn't apply."}
          </p>
          <ul className="flex flex-col gap-1 mb-4">
            {suggested.map((p) => {
              const key = `${p.startDate}|${p.endDate}`;
              return (
                <li key={key}>
                  <label className="flex items-center gap-2.5 py-1.5 cursor-pointer">
                    <input type="checkbox" checked={chosen.has(key)} onChange={() => toggle(key)} className="w-4 h-4 accent-[#1B7FA0]" />
                    <span className="text-sm text-gray-800 font-medium">{p.label}</span>
                    <span className="text-sm text-gray-600 tabular-nums" dir="ltr">{fmtRange(p.startDate, p.endDate)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-3">
            <button
              onClick={saveSuggested}
              disabled={saving || chosen.size === 0 || !description.trim()}
              className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
            >
              {saving ? "…" : he ? `הוסף ${chosen.size} תאריכים` : `Add ${chosen.size} dates`}
            </button>
            <button onClick={() => setSuggested(null)} className="text-sm text-gray-600 hover:text-gray-900 px-2 py-2">
              {he ? "ביטול" : "Cancel"}
            </button>
            {!description.trim() && (
              <span className="text-xs text-amber-700">{he ? "מלא קודם מה משתנה" : "Fill in what changes first"}</span>
            )}
          </div>
        </div>
      )}

      <details className="bg-white border border-gray-200 rounded-xl mb-4">
        <summary className="px-5 py-3 text-sm font-medium text-gray-800 cursor-pointer">
          {he ? "הוספת תאריכים ידנית" : "Add dates manually"}
        </summary>
        <form onSubmit={addManual} className="px-5 pb-5 pt-1 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="sp-from" className="block text-xs font-medium text-gray-600 mb-1.5">{he ? "מתאריך" : "From"}</label>
            <input id="sp-from" type="date" value={manualStart} onChange={(e) => setManualStart(e.target.value)} required dir="ltr" />
          </div>
          <div>
            <label htmlFor="sp-to" className="block text-xs font-medium text-gray-600 mb-1.5">{he ? "עד (רשות)" : "To (optional)"}</label>
            <input id="sp-to" type="date" value={manualEnd} onChange={(e) => setManualEnd(e.target.value)} dir="ltr" />
          </div>
          <button
            type="submit"
            disabled={saving || !description.trim()}
            className="bg-white border border-[#1B7FA0] text-[#197492] hover:bg-[#E0F5FB] disabled:opacity-50 text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            {he ? "הוסף" : "Add"}
          </button>
          <p className="text-xs text-gray-600 basis-full">
            {he ? "משתמש בשם ובתיאור שמילאת למעלה." : "Uses the name and description filled in above."}
          </p>
        </form>
      </details>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {!loaded ? (
          <div className="px-6 py-10 text-center text-gray-600 text-sm">…</div>
        ) : periods.length === 0 ? (
          <div className="px-6 py-10 text-center text-gray-600 text-sm">
            {he ? "אין עדיין תאריכים מיוחדים" : "No special dates yet"}
          </div>
        ) : (
          <ul>
            {periods.map((p, i) => (
              <li
                key={p.id}
                className={`flex items-center justify-between gap-3 px-5 py-3.5 ${i !== periods.length - 1 ? "border-b border-gray-100" : ""}`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-800 flex items-center gap-2 flex-wrap">
                    <span>{p.label}</span>
                    <span className="text-gray-600 tabular-nums" dir="ltr">{fmtRange(p.startDate, p.endDate)}</span>
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5">{p.description}</div>
                </div>
                <button
                  onClick={() => remove(p.id)}
                  className="row-action text-xs text-gray-600 hover:text-red-600 transition px-2 py-1 rounded hover:bg-red-50 shrink-0"
                >
                  {he ? "הסר" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
