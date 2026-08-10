import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.GOOGLE_PLACES_API_KEY = "test-key";

const { discoverBusinesses, buildQueries, MAX_QUERIES_PER_RUN } = await import("./placesClient.js");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

/**
 * Pagination waits on real timers (a page token needs seconds to become valid). Firing them
 * immediately keeps the suite fast; the delays themselves are Google's contract, not our logic,
 * so there is nothing lost in not waiting them out here.
 */
const realSetTimeout = globalThis.setTimeout;
beforeEach(() => {
  vi.clearAllMocks();
  globalThis.setTimeout = ((fn: () => void) => realSetTimeout(fn, 0)) as typeof globalThis.setTimeout;
});
afterEach(() => {
  globalThis.setTimeout = realSetTimeout;
});

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const place = (id: string) => ({ place_id: id, name: `place ${id}`, formatted_address: "somewhere" });
const details = (id: string) =>
  ok({ status: "OK", result: { place_id: id, name: `place ${id}`, website: "https://x.test" } });

/** Text search pages, then a details lookup per distinct place. */
function respondWith(pages: unknown[]) {
  let i = 0;
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/details/")) return details(new URL(url).searchParams.get("place_id")!);
    return ok(pages[i++] ?? { status: "ZERO_RESULTS", results: [] });
  });
}

describe("buildQueries", () => {
  it("makes one query from single terms, unchanged", () => {
    expect(buildQueries("מספרות", "חיפה")).toEqual(["מספרות חיפה"]);
  });

  it("crosses every category term with every location term", () => {
    // This is the whole point of the lists: nine searches reach places no amount of paging on
    // "מספרות תל אביב" would have returned, because Google caps a single query at ~60.
    const queries = buildQueries("מספרות | ברברשופ", "תל אביב | רמת גן | גבעתיים");
    expect(queries).toHaveLength(6);
    expect(queries).toContain("ברברשופ גבעתיים");
  });

  it("ignores blank terms from a trailing separator", () => {
    expect(buildQueries("מספרות | ", "חיפה")).toEqual(["מספרות חיפה"]);
  });

  it("leaves a descriptive comma alone", () => {
    // Existing campaigns write locations like this; splitting on the comma would add a garbage
    // "מספרות רדיוס 15 ק״מ" search whose junk leads would read as ordinary bad results.
    expect(buildQueries("מספרות", "חיפה, רדיוס 15 ק״מ")).toEqual(["מספרות חיפה, רדיוס 15 ק״מ"]);
  });

  it("caps the cross product, since it grows faster than it looks while typing", () => {
    const many = Array.from({ length: 10 }, (_, i) => `c${i}`).join("|");
    expect(buildQueries(many, many)).toHaveLength(MAX_QUERIES_PER_RUN);
  });
});

describe("discoverBusinesses", () => {
  it("follows next_page_token past the first page", async () => {
    respondWith([
      { status: "OK", results: [place("a")], next_page_token: "t1" },
      { status: "OK", results: [place("b")], next_page_token: "t2" },
      { status: "OK", results: [place("c")] },
    ]);
    const found = await discoverBusinesses("מספרות", "חיפה");
    expect(found.map((b) => b.placeId)).toEqual(["a", "b", "c"]);
  });

  it("retries a page token Google hasn't materialized yet", async () => {
    // The bug this pins: INVALID_REQUEST on a fresh token used to end pagination silently, which
    // capped every campaign at one page — exactly 20 leads — with nothing to indicate more existed.
    respondWith([
      { status: "OK", results: [place("a")], next_page_token: "t1" },
      { status: "INVALID_REQUEST" },
      { status: "OK", results: [place("b")] },
    ]);
    const found = await discoverBusinesses("מספרות", "חיפה");
    expect(found.map((b) => b.placeId)).toEqual(["a", "b"]);
  });

  it("gives up on a token that stays invalid, keeping what it already has", async () => {
    respondWith([
      { status: "OK", results: [place("a")], next_page_token: "t1" },
      { status: "INVALID_REQUEST" },
      { status: "INVALID_REQUEST" },
      { status: "INVALID_REQUEST" },
      { status: "INVALID_REQUEST" },
    ]);
    expect((await discoverBusinesses("מספרות", "חיפה")).map((b) => b.placeId)).toEqual(["a"]);
  });

  it("looks a place up once when several queries return it", async () => {
    // Neighbouring cities and near-synonym categories overlap constantly, and every details lookup
    // is billed — deduping after the details pass would pay for each duplicate.
    respondWith([
      { status: "OK", results: [place("a"), place("b")] },
      { status: "OK", results: [place("b"), place("c")] },
    ]);
    const found = await discoverBusinesses("מספרות", "תל אביב | רמת גן");
    expect(found.map((b) => b.placeId)).toEqual(["a", "b", "c"]);
    const detailCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/details/"));
    expect(detailCalls).toHaveLength(3);
  });

  it("keeps the other queries when one fails outright", async () => {
    let call = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/details/")) return details("b");
      call += 1;
      if (call === 1) return { ok: false, status: 500, text: async () => "boom" };
      return ok({ status: "OK", results: [place("b")] });
    });
    // Losing every other query's results to one bad query would make expanding strictly worse
    // than not expanding.
    expect((await discoverBusinesses("מספרות", "תל אביב | רמת גן")).map((b) => b.placeId)).toEqual(["b"]);
  });

  it("still fails loudly when the only query fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => "denied" });
    // A single-query campaign that returns nothing is a broken key or quota, not a thin result set,
    // and the operator needs to see that rather than an empty list.
    await expect(discoverBusinesses("מספרות", "חיפה")).rejects.toThrow(/403/);
  });
});
