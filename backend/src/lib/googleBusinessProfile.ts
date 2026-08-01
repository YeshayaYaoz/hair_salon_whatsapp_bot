import { getValidAccessToken } from "./googleCalendar.js";

/**
 * Imports opening hours from the business's Google Business Profile — the hours customers already
 * see on Google Search and Maps — so the owner doesn't maintain the same table twice and the bot
 * can't contradict Google.
 *
 * Reuses the existing Google OAuth connection (same client, same stored refresh token); the only
 * addition is the `business.manage` scope, which older connections won't have granted. A 403 is
 * therefore expected for anyone who connected before this existed, and is reported as
 * "reconnect needed" rather than as a failure.
 *
 * NOTE ON ACCESS: the Business Profile APIs are restricted. Google must approve the Cloud project
 * for them before any of these calls succeed — until then they return 403/404 regardless of the
 * OAuth scope. See docs/google-business-profile.md.
 */

export const GOOGLE_BUSINESS_SCOPE = "https://www.googleapis.com/auth/business.manage";

const ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";

export class GoogleBusinessAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleBusinessAuthError";
  }
}

export class GoogleBusinessAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleBusinessAccessError";
  }
}

/** One day's hours in this app's representation: minutes from midnight, 0 = Sunday. */
export interface ImportedDayHours {
  dayOfWeek: number;
  openMin: number;
  closeMin: number;
}

export interface GoogleTimeOfDay {
  hours?: number;
  minutes?: number;
}

export interface GoogleHoursPeriod {
  openDay?: string;
  openTime?: GoogleTimeOfDay;
  closeDay?: string;
  closeTime?: GoogleTimeOfDay;
}

const DAY_INDEX: Record<string, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

function toMinutes(t: GoogleTimeOfDay | undefined): number | null {
  if (!t) return null;
  const h = t.hours ?? 0; // Google omits the field entirely for midnight rather than sending 0
  const m = t.minutes ?? 0;
  if (h < 0 || h > 24 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Converts Google's periods into this app's one-row-per-day hours.
 *
 * Two shapes don't map cleanly and are handled explicitly rather than silently mangled:
 * - Split hours (morning + afternoon with a break) are one day with several periods in Google, but
 *   this app stores a single open/close pair per day. They're merged into earliest-open to
 *   latest-close, and the day is reported back so the owner is told the break was dropped.
 * - Overnight periods (open Friday 20:00, close Saturday 02:00) would become a negative or
 *   nonsensical range, so they're skipped and reported rather than imported wrong.
 */
export function mapGoogleHours(periods: GoogleHoursPeriod[]): {
  hours: ImportedDayHours[];
  mergedDays: number[];
  skippedDays: number[];
} {
  const byDay = new Map<number, { open: number; close: number }[]>();
  const skipped = new Set<number>();

  for (const p of periods) {
    const day = DAY_INDEX[(p.openDay ?? "").toUpperCase()];
    if (day === undefined) continue;
    const open = toMinutes(p.openTime);
    let close = toMinutes(p.closeTime);
    if (open === null || close === null) continue;

    const closeDay = DAY_INDEX[(p.closeDay ?? p.openDay ?? "").toUpperCase()];
    if (closeDay !== day) {
      // Closing on a later day means the business runs past midnight.
      skipped.add(day);
      continue;
    }
    // Google represents "open 24 hours" as 00:00–00:00.
    if (open === 0 && close === 0) close = 24 * 60;
    if (close <= open) {
      skipped.add(day);
      continue;
    }
    byDay.set(day, [...(byDay.get(day) ?? []), { open, close }]);
  }

  const hours: ImportedDayHours[] = [];
  const mergedDays: number[] = [];
  for (const [day, ranges] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    if (ranges.length > 1) mergedDays.push(day);
    hours.push({
      dayOfWeek: day,
      openMin: Math.min(...ranges.map((r) => r.open)),
      closeMin: Math.max(...ranges.map((r) => r.close)),
    });
  }
  return { hours, mergedDays, skippedDays: [...skipped].sort((a, b) => a - b) };
}

async function googleGet<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) throw new GoogleBusinessAuthError("Google access token rejected");
  if (res.status === 403 || res.status === 404) {
    const body = await res.text();
    throw new GoogleBusinessAccessError(`Business Profile API unavailable (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
  if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export interface GoogleLocation {
  /** Google's resource name, e.g. "locations/123". Stored so a multi-location owner keeps a choice. */
  name: string;
  title: string;
  periods: GoogleHoursPeriod[];
}

/** Lists the locations this Google account manages, with their published regular hours. */
export async function fetchGoogleLocations(businessId: string): Promise<GoogleLocation[]> {
  const accessToken = await getValidAccessToken(businessId);
  if (!accessToken) throw new GoogleBusinessAuthError("Google is not connected for this business");

  const accounts = await googleGet<{ accounts?: { name: string }[] }>(`${ACCOUNTS_API}/accounts`, accessToken);
  const out: GoogleLocation[] = [];
  for (const account of accounts.accounts ?? []) {
    const res = await googleGet<{
      locations?: { name: string; title?: string; regularHours?: { periods?: GoogleHoursPeriod[] } }[];
    }>(`${INFO_API}/${account.name}/locations?readMask=name,title,regularHours&pageSize=100`, accessToken);
    for (const loc of res.locations ?? []) {
      out.push({ name: loc.name, title: loc.title ?? loc.name, periods: loc.regularHours?.periods ?? [] });
    }
  }
  return out;
}
