/**
 * Website enrichment heuristics for a Lead Finder lead. Given a website URL, fetches the page
 * and looks for signals: existing online booking widget, contact form, WhatsApp presence, and
 * how stale the site looks. Best-effort only — a slow, broken, or blocking website must never
 * abort the run, so every failure mode here degrades to null/false rather than throwing.
 */

const FETCH_TIMEOUT_MS = 8000;

export interface EnrichmentResult {
  hasOnlineBooking: boolean | null;
  hasContactForm: boolean | null;
  whatsappDetected: boolean;
  websiteStale: boolean | null;
}

const BOOKING_SIGNALS = [
  "book now",
  "book an appointment",
  "schedule now",
  "הזמן תור",
  "קביעת תור",
  "לקביעת תור",
  "calendly.com",
  "wixbookings",
  "wix-bookings",
  "setmore.com",
  "square.site/book",
  "booksy.com",
  "simplybook.me",
  "acuityscheduling.com",
];

const WHATSAPP_SIGNALS = ["wa.me/", "api.whatsapp.com", "וואטסאפ", "whatsapp.com/send"];

const EMPTY_RESULT: EnrichmentResult = {
  hasOnlineBooking: null,
  hasContactForm: null,
  whatsappDetected: false,
  websiteStale: null,
};

async function fetchWithTimeout(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ToriLeadFinder/1.0)" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    console.warn(`[enrichment] Failed to fetch ${url}:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Best-effort staleness check: look for a copyright year in the page and compare to now. */
function detectStaleWebsite(html: string): boolean | null {
  const matches = [...html.matchAll(/(?:©|copyright)\D{0,10}(\d{4})/gi)];
  if (matches.length === 0) return null; // no signal either way — don't guess
  const years = matches.map((m) => parseInt(m[1], 10)).filter((y) => y > 1990 && y <= new Date().getFullYear() + 1);
  if (years.length === 0) return null;
  const mostRecent = Math.max(...years);
  return new Date().getFullYear() - mostRecent >= 2;
}

/**
 * Enriches a single lead from its website. Normalizes the URL (adds https:// if missing).
 * Returns EMPTY_RESULT (all null/false) if there's no website or the fetch fails — never throws.
 */
export async function enrichWebsite(website: string | null): Promise<EnrichmentResult> {
  if (!website) return EMPTY_RESULT;

  let url = website.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  const html = await fetchWithTimeout(url);
  if (html === null) return EMPTY_RESULT;

  const lowerHtml = html.toLowerCase();

  return {
    hasOnlineBooking: BOOKING_SIGNALS.some((s) => lowerHtml.includes(s.toLowerCase())),
    hasContactForm: /<form[\s>]/i.test(html),
    whatsappDetected: WHATSAPP_SIGNALS.some((s) => lowerHtml.includes(s.toLowerCase())),
    websiteStale: detectStaleWebsite(html),
  };
}
