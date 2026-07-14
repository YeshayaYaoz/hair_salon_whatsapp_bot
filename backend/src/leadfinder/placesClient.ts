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

/**
 * Text Search for businesses matching a category + free-text location query
 * (e.g. category="ספרים", locationQuery="חיפה"). Returns up to one page of results
 * (~20 places) — good enough for the foundation pass; pagination via next_page_token
 * can be added later if campaigns need more coverage per run.
 */
async function textSearch(category: string, locationQuery: string): Promise<TextSearchResult[]> {
  const apiKey = getApiKey();
  const query = `${category} ${locationQuery}`;
  const url = new URL(PLACES_TEXT_SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Google Places text search failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as TextSearchResponse;
  if (body.status !== "OK" && body.status !== "ZERO_RESULTS") {
    throw new Error(`Google Places text search returned ${body.status}: ${body.error_message ?? "unknown error"}`);
  }
  return body.results ?? [];
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
