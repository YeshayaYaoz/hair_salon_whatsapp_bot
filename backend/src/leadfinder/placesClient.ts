/**
 * Thin wrapper around the Google Places API (Text Search + Place Details endpoints) used to
 * discover businesses for a Lead Finder campaign. Uses raw `fetch` — matches the style of
 * other optional-integration clients in this codebase (see ../lib/transcription.ts) rather
 * than pulling in a new HTTP client dependency.
 *
 * Structured as a single well-organized file rather than behind an abstract "data source"
 * interface — there's only one provider today, and an interface with a single implementation
 * would be pure ceremony. If a second discovery source is ever added, extract an interface then.
 */

const PLACES_TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json";
const PLACES_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json";

export class PlacesNotConfiguredError extends Error {
  constructor() {
    super("GOOGLE_PLACES_API_KEY is not set — Lead Finder discovery is unavailable");
    this.name = "PlacesNotConfiguredError";
  }
}

export interface DiscoveredBusiness {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  businessHours: string[] | null;
  // Google Places API does not return social media links (Instagram/Facebook/etc.) — this is
  // always null from this client. Left as a field so a future enrichment source could fill it.
  socialLinks: null;
}

interface TextSearchResult {
  place_id: string;
  name: string;
  formatted_address?: string;
}

interface TextSearchResponse {
  status: string;
  error_message?: string;
  results: TextSearchResult[];
  next_page_token?: string;
}

interface PlaceDetailsResult {
  place_id: string;
  name: string;
  formatted_address?: string;
  formatted_phone_number?: string;
  international_phone_number?: string;
  website?: string;
  rating?: number;
  user_ratings_total?: number;
  opening_hours?: { weekday_text?: string[] };
}

interface PlaceDetailsResponse {
  status: string;
  error_message?: string;
  result?: PlaceDetailsResult;
}

function getApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new PlacesNotConfiguredError();
  return key;
}

// Google returns ~20 results per page and caps Text Search at 3 pages (~60 results) total.
const MAX_SEARCH_PAGES = 3;
/**
 * A next_page_token isn't valid immediately — Google needs a moment to materialize the next page,
 * and querying too soon returns INVALID_REQUEST. This delay is required, not a politeness pause.
 *
 * Two seconds is the commonly cited figure but it is not a guarantee, and a token that isn't ready
 * yet reports INVALID_REQUEST rather than anything retry-shaped. That used to end pagination on the
 * spot, which capped a whole campaign at the first page — exactly 20 leads — with nothing in the
 * result to suggest more existed. Hence the retry below rather than a longer fixed sleep: waiting
 * longer on every run to cover the slow case costs every run.
 */
const NEXT_PAGE_TOKEN_DELAY_MS = 2000;
const TOKEN_NOT_READY_RETRIES = 3;
const TOKEN_RETRY_BACKOFF_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One Text Search query, following next_page_token to Google's 3-page limit (~60 places).
 *
 * A failed or expired token stops pagination and returns what we have rather than failing the whole
 * run — partial discovery is worth more than an aborted campaign.
 */
async function textSearch(query: string): Promise<TextSearchResult[]> {
  const apiKey = getApiKey();
  const collected: TextSearchResult[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
    const url = new URL(PLACES_TEXT_SEARCH_URL);
    url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pagetoken", pageToken);
    else url.searchParams.set("query", query);

    let body: TextSearchResponse | null = null;

    // Attempt 0 is the request itself; the rest exist only for a token Google hasn't materialized.
    for (let attempt = 0; attempt <= TOKEN_NOT_READY_RETRIES; attempt++) {
      const res = await fetch(url.toString());
      if (!res.ok) {
        // The first page failing is a real error; a later page failing just ends pagination.
        if (page === 0) throw new Error(`Google Places text search failed (${res.status}): ${await res.text()}`);
        console.warn(`[placesClient] Page ${page + 1} failed (${res.status}) — returning ${collected.length} results so far`);
        break;
      }

      const parsed = (await res.json()) as TextSearchResponse;
      const tokenNotReady = parsed.status === "INVALID_REQUEST" && Boolean(pageToken);
      if (tokenNotReady && attempt < TOKEN_NOT_READY_RETRIES) {
        await sleep(TOKEN_RETRY_BACKOFF_MS * (attempt + 1));
        continue;
      }
      body = parsed;
      break;
    }

    if (!body) break;

    if (body.status !== "OK" && body.status !== "ZERO_RESULTS") {
      if (page === 0) {
        throw new Error(`Google Places text search returned ${body.status}: ${body.error_message ?? "unknown error"}`);
      }
      console.warn(`[placesClient] Page ${page + 1} returned ${body.status} — stopping pagination`);
      break;
    }

    collected.push(...(body.results ?? []));
    if (!body.next_page_token) break;
    pageToken = body.next_page_token;
    await sleep(NEXT_PAGE_TOKEN_DELAY_MS);
  }

  return collected;
}

/**
 * Splits an operator-typed field into search terms.
 *
 * Both the category and the location field accept a "|"-separated list, which is what makes a
 * campaign expandable past Google's per-query ceiling: "מספרות | ברברשופ | סטודיו לציפורניים"
 * across "תל אביב | רמת גן | גבעתיים" is nine queries rather than one, and no amount of paging on
 * a single query would have reached those places. A single term behaves exactly as before.
 *
 * Deliberately not the comma: existing campaigns write locations like "חיפה, רדיוס 15 ק״מ", where
 * the comma is descriptive. Splitting on it would silently turn every one of those into a real
 * campaign plus a garbage "רדיוס 15 ק״מ" query, and the junk leads it returned would look like
 * ordinary bad results rather than a separator bug.
 */
function splitTerms(field: string): string[] {
  const terms = field
    .split(/[|\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
  return terms.length > 0 ? terms : [field.trim()];
}

/**
 * Ceiling on queries per run, so a long list pasted into both fields can't quietly multiply into
 * hundreds of billable searches — the cross product grows faster than it looks while typing.
 */
export const MAX_QUERIES_PER_RUN = 24;

/** Builds the query list for a run: every category term against every location term. */
export function buildQueries(category: string, locationQuery: string): string[] {
  const queries: string[] = [];
  for (const loc of splitTerms(locationQuery)) {
    for (const cat of splitTerms(category)) {
      queries.push(`${cat} ${loc}`);
    }
  }
  if (queries.length > MAX_QUERIES_PER_RUN) {
    console.warn(
      `[placesClient] ${queries.length} query combinations requested — running the first ${MAX_QUERIES_PER_RUN}`
    );
    return queries.slice(0, MAX_QUERIES_PER_RUN);
  }
  return queries;
}

/** Place Details lookup for a single place_id — fills in phone/website/rating/hours. */
async function getPlaceDetails(placeId: string): Promise<PlaceDetailsResult | null> {
  const apiKey = getApiKey();
  const url = new URL(PLACES_DETAILS_URL);
  url.searchParams.set("place_id", placeId);
  url.searchParams.set(
    "fields",
    "place_id,name,formatted_address,formatted_phone_number,international_phone_number,website,rating,user_ratings_total,opening_hours"
  );
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Google Places details lookup failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as PlaceDetailsResponse;
  if (body.status !== "OK") {
    console.warn(`[placesClient] Details lookup for ${placeId} returned ${body.status}: ${body.error_message ?? ""}`);
    return null;
  }
  return body.result ?? null;
}

/**
 * Discovers businesses for a category + location query. Runs a text search per query combination,
 * then fetches details for each distinct result to get phone/website/rating/hours. Individual
 * detail-lookup failures are logged and skipped rather than failing the whole discovery — one bad
 * place shouldn't abort an entire campaign run.
 *
 * Deduplication happens on place_id *before* the details pass, not after. Overlapping terms are the
 * normal case once the fields hold lists — neighbouring cities share businesses, and "מספרה" and
 * "ברברשופ" return many of the same places — and a details lookup is a billable call each time.
 *
 * A query that fails outright is logged and skipped rather than aborting the run, since with
 * several queries the odds of one failing rise with the breadth the operator asked for, and losing
 * every other query's results to it would make expansion strictly worse than not expanding.
 */
export async function discoverBusinesses(category: string, locationQuery: string): Promise<DiscoveredBusiness[]> {
  const queries = buildQueries(category, locationQuery);
  const byPlaceId = new Map<string, TextSearchResult>();

  for (const query of queries) {
    try {
      for (const result of await textSearch(query)) {
        if (!byPlaceId.has(result.place_id)) byPlaceId.set(result.place_id, result);
      }
    } catch (err) {
      if (queries.length === 1) throw err;
      console.warn(`[placesClient] Query "${query}" failed — continuing with the rest:`, err);
    }
  }

  const results = [...byPlaceId.values()];
  const businesses: DiscoveredBusiness[] = [];

  for (const result of results) {
    let details: PlaceDetailsResult | null = null;
    try {
      details = await getPlaceDetails(result.place_id);
    } catch (err) {
      console.warn(`[placesClient] Failed to fetch details for ${result.place_id}:`, err);
    }

    businesses.push({
      placeId: result.place_id,
      name: details?.name ?? result.name,
      address: details?.formatted_address ?? result.formatted_address ?? null,
      phone: details?.formatted_phone_number ?? details?.international_phone_number ?? null,
      website: details?.website ?? null,
      rating: details?.rating ?? null,
      reviewCount: details?.user_ratings_total ?? null,
      businessHours: details?.opening_hours?.weekday_text ?? null,
      socialLinks: null,
    });
  }

  return businesses;
}
