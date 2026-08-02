/**
 * Render appointment times in the BUSINESS timezone, not the viewer's device timezone.
 * Appointments are stored as absolute UTC instants; a salon owner viewing from a device set
 * to a different timezone (or UTC) would otherwise see times shifted by the offset.
 */

export const DEFAULT_TZ = "Asia/Jerusalem";

export function formatTimeInTz(iso: string, timeZone = DEFAULT_TZ, locale?: string): string {
  return new Date(iso).toLocaleTimeString(locale, { timeZone, hour: "2-digit", minute: "2-digit" });
}

export function formatDateTimeInTz(iso: string, timeZone = DEFAULT_TZ, locale?: string): string {
  return new Date(iso).toLocaleString(locale, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A plain calendar date (not an instant) rendered in an explicit locale — e.g. the week-range label
 * above the calendar.
 *
 * `locale` is required rather than optional on purpose. Passing `undefined` to toLocaleDateString
 * means "use the ambient locale", which differs between the server (Node, en-US) and the browser
 * (the device's locale) — that mismatch fails hydration and makes React discard the entire server
 * render. It also ignores the app's own language toggle, so a Hebrew UI on an en-US browser would
 * show English dates. Always derive it from `lang`, via `localeFor()`.
 */
export function formatDateIn(date: Date, locale: string, opts: Intl.DateTimeFormatOptions): string {
  return date.toLocaleDateString(locale, opts);
}

/** Maps the app's language toggle to a BCP-47 tag for the Intl APIs. */
export function localeFor(lang: string): string {
  return lang === "he" ? "he-IL" : "en-US";
}

/** Calendar components of a UTC instant as seen in `timeZone` — for day/hour grouping. */
export function partsInTz(iso: string, timeZone = DEFAULT_TZ): { y: number; m: number; d: number; hour: number; dow: number } {
  const date = new Date(iso);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: +map.year,
    m: +map.month,
    d: +map.day,
    hour: map.hour === "24" ? 0 : +map.hour,
    dow: dowMap[map.weekday],
  };
}

/** "YYYY-MM-DD" of a UTC instant as seen in `timeZone`. */
export function dayKeyInTz(iso: string | Date, timeZone = DEFAULT_TZ): string {
  const p = partsInTz(typeof iso === "string" ? iso : iso.toISOString(), timeZone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
