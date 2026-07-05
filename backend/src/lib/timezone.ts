/**
 * Timezone-aware date helpers built on Intl (no external deps).
 * Business hours are stored as "minutes from midnight" in the business's local
 * timezone, but appointments are stored as absolute UTC instants. These helpers
 * bridge the two correctly, including DST transitions.
 */

/** Offset in ms such that: utcInstant.getTime() + offset = wall-clock time in `timeZone`. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  // formatToParts can yield hour "24" at midnight in some environments
  const hour = map.hour === "24" ? "00" : map.hour;
  const asUTC = Date.UTC(+map.year, +map.month - 1, +map.day, +hour, +map.minute, +map.second);
  return asUTC - date.getTime();
}

/** Build the UTC instant for a wall-clock time (year/month/day + minutes-from-midnight) in `timeZone`. */
export function zonedWallTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  minutesFromMidnight: number,
  timeZone: string
): Date {
  const hh = Math.floor(minutesFromMidnight / 60);
  const mm = minutesFromMidnight % 60;
  // First guess: pretend the wall time is already UTC, then correct by the offset at that instant.
  const guess = Date.UTC(year, month - 1, day, hh, mm);
  const offset = tzOffsetMs(new Date(guess), timeZone);
  // Refine once more to be safe around DST boundaries.
  const refined = Date.UTC(year, month - 1, day, hh, mm) - offset;
  const offset2 = tzOffsetMs(new Date(refined), timeZone);
  return new Date(Date.UTC(year, month - 1, day, hh, mm) - offset2);
}

/** Extract {year, month, day, dayOfWeek} of a UTC instant as seen in `timeZone`. */
export function zonedDateParts(date: Date, timeZone: string): { year: number; month: number; day: number; dayOfWeek: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: +map.year,
    month: +map.month,
    day: +map.day,
    dayOfWeek: dowMap[map.weekday],
  };
}

/** Parse a "YYYY-MM-DD" date string into calendar components (no timezone shift). */
export function parseDateString(dateStr: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.slice(0, 10).split("-").map(Number);
  return { year, month, day };
}

/** Day of week (0=Sun) for a YYYY-MM-DD calendar date. */
export function dayOfWeekForDate(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}
