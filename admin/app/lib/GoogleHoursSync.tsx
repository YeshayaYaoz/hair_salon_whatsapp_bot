"use client";

import { useState } from "react";
import { apiFetch } from "./api";
import { useLanguage } from "./LanguageContext";

interface ImportedDay {
  dayOfWeek: number;
  openMin: number;
  closeMin: number;
}

interface GoogleLocationHours {
  name: string;
  title: string;
  hours: ImportedDay[];
  mergedDays: number[];
  skippedDays: number[];
}

function hhmm(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/**
 * One button that pulls the opening hours already published on the business's Google profile.
 *
 * Nothing is written until the owner sees the hours and confirms. Google is the source customers
 * already trust — if the two disagree, the bot is the one that looks wrong — but it's still the
 * owner's schedule, and an import that silently overwrote a hand-tuned week would be worse than no
 * import at all.
 */
export function GoogleHoursSync({ onApplied }: { onApplied: () => void }) {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [locations, setLocations] = useState<GoogleLocationHours[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);

  const dayNames = he
    ? ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]
    : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  async function fetchHours() {
    setLoading(true);
    setError(null);
    setNeedsConnect(false);
    try {
      const res = await apiFetch<{ locations: GoogleLocationHours[] }>("/api/business/google-business/hours");
      if (res.locations.length === 0) {
        setError(he ? "לא נמצא עסק מקושר לחשבון Google הזה." : "No business found on this Google account.");
        return;
      }
      setLocations(res.locations);
      setSelected(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The Business Profile scope is newer than the calendar connection, so anyone who connected
      // Google before this feature has a valid token that simply lacks permission for it.
      if (/reconnect|חבר מחדש|401/.test(message)) setNeedsConnect(true);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function connect() {
    try {
      const { url } = await apiFetch<{ url: string }>("/api/business/google-business/auth-url");
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function apply() {
    if (!locations) return;
    setApplying(true);
    setError(null);
    try {
      await apiFetch("/api/business/google-business/hours/apply", {
        method: "POST",
        body: JSON.stringify({ hours: locations[selected].hours }),
      });
      setLocations(null);
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  const loc = locations?.[selected];

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={fetchHours}
          disabled={loading}
          className="inline-flex items-center gap-2 bg-white border border-gray-300 hover:border-[#1B7FA0] hover:bg-[#E0F5FB] disabled:opacity-50 text-gray-800 text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
            <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" />
            <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1z" />
            <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
          </svg>
          {loading ? "…" : he ? "סנכרן שעות מ-Google" : "Sync hours from Google"}
        </button>
        <p className="text-xs text-gray-600">
          {he
            ? "מייבא את שעות הפעילות שמופיעות ללקוחות בחיפוש ובמפות. תראה אותן לפני שנשמרות."
            : "Imports the hours customers see on Search and Maps. You review them before anything is saved."}
        </p>
      </div>

      {error && (
        <div className="mt-3 text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2">
          <p>{error}</p>
          {needsConnect && (
            <button onClick={connect} className="mt-2 text-sm font-semibold text-[#1B7FA0] hover:underline">
              {he ? "חבר את חשבון Google" : "Connect Google account"}
            </button>
          )}
        </div>
      )}

      {loc && (
        <div className="mt-3 bg-white border border-[#1B7FA0]/30 rounded-xl p-5">
          {locations!.length > 1 && (
            <div className="mb-3">
              <label htmlFor="gh-loc" className="block text-xs font-medium text-gray-600 mb-1.5">
                {he ? "איזה סניף?" : "Which location?"}
              </label>
              <select id="gh-loc" value={selected} onChange={(e) => setSelected(Number(e.target.value))} className="w-full">
                {locations!.map((l, i) => (
                  <option key={l.name} value={i}>{l.title}</option>
                ))}
              </select>
            </div>
          )}

          <h3 className="text-sm font-semibold text-gray-900 mb-2">
            {he ? `השעות ב-Google עבור ${loc.title}` : `Google hours for ${loc.title}`}
          </h3>

          {loc.hours.length === 0 ? (
            <p className="text-sm text-gray-600">{he ? "לא הוגדרו שעות פעילות בפרופיל הזה ב-Google." : "This Google profile has no opening hours set."}</p>
          ) : (
            <ul className="flex flex-col gap-1 mb-3">
              {loc.hours.map((h) => (
                <li key={h.dayOfWeek} className="flex items-center gap-3 text-sm">
                  <span className="text-gray-800 w-20">{dayNames[h.dayOfWeek]}</span>
                  <span className="text-gray-600 tabular-nums" dir="ltr">{hhmm(h.openMin)}–{hhmm(h.closeMin)}</span>
                </li>
              ))}
            </ul>
          )}

          {loc.mergedDays.length > 0 && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
              {he
                ? `ב-Google יש הפסקה באמצע היום ב${loc.mergedDays.map((d) => dayNames[d]).join(", ")}. כאן נשמר טווח אחד רציף — אם צריך הפסקה, הוסף אותה כחסימה אחרי הייבוא.`
                : `Google has a mid-day break on ${loc.mergedDays.map((d) => dayNames[d]).join(", ")}. This app stores one continuous range per day — add the break as a block after importing.`}
            </p>
          )}
          {loc.skippedDays.length > 0 && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
              {he
                ? `דילגתי על ${loc.skippedDays.map((d) => dayNames[d]).join(", ")} — השעות שם חוצות חצות, וזה לא נתמך כאן. הגדר אותן ידנית.`
                : `Skipped ${loc.skippedDays.map((d) => dayNames[d]).join(", ")} — those hours cross midnight, which isn't supported here. Set them manually.`}
            </p>
          )}

          <p className="text-xs text-gray-600 mb-3">
            {he
              ? "שמירה תחליף את כל שעות הפעילות הקיימות. ימים שלא מופיעים למעלה ייחשבו סגורים."
              : "Saving replaces all current opening hours. Days not listed above are treated as closed."}
          </p>

          <div className="flex items-center gap-3">
            <button
              onClick={apply}
              disabled={applying || loc.hours.length === 0}
              className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
            >
              {applying ? "…" : he ? "החלף את השעות שלי" : "Replace my hours"}
            </button>
            <button onClick={() => setLocations(null)} className="text-sm text-gray-600 hover:text-gray-900 px-2 py-2">
              {he ? "ביטול" : "Cancel"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
