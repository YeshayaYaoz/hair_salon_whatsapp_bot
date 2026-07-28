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
// A next_page_token isn't valid immediately — Google needs a moment to materialize the next page,
// and querying too soon returns INVALID_REQUEST. This delay is required, not a politeness pause.
const NEXT_PAGE_TOKEN_DELAY_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Text Search for businesses matching a category + free-text location query
 * (e.g. category="ספרים", locationQuery="חיפה"). Follows next_page_token up to Google's 3-page
 * limit so a campaign run covers ~60 places instead of only the first ~20. A failed or expired
 * token stops pagination and returns what we have rather than failing the whole run.
 */
async function textSearch(category: string, locationQuery: string): Promise<TextSearchResult[]> {
  const apiKey = getApiKey();
  const query = `${category} ${locationQuery}`;
  const collected: TextSearchResult[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
    const url = new URL(PLACES_TEXT_SEARCH_URL);
    url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pagetoken", pageToken);
    else url.searchParams.set("query", query);

    const res = await fetch(url.toString());
    if (!res.ok) {
      // The first page failing is a real error; a later page failing just ends pagination.
      if (page === 0) throw new Error(`Google Places text search failed (${res.status}): ${await res.text()}`);
      console.warn(`[placesClient] Page ${page + 1} failed (${res.status}) — returning ${collected.length} results so far`);
      break;
    }

    const body = (await res.json()) as TextSearchResponse;
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
 * Discovers businesses for a category + location query. Runs a text search, then fetches
 * details for each result to get phone/website/rating/hours. Individual detail-lookup failures
 * are logged and skipped rather than failing the whole discovery — one bad place shouldn't
 * abort an entire campaign run.
 */
export async function discoverBusinesses(category: string, locationQuery: string): Promise<DiscoveredBusiness[]> {
  const results = await textSearch(category, locationQuery);
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
