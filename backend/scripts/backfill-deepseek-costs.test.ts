import { describe, it, expect, vi } from "vitest";
import { recompute } from "./backfill-deepseek-costs.js";

const create = vi.fn();
vi.mock("../src/lib/prisma.js", () => ({ prisma: { apiUsageEvent: { create } } }));

const { logClaudeUsage } = await import("../src/lib/usageLedger.js");

/**
 * This script rewrites real billing history in place and cannot be re-run to correct itself, so an
 * arithmetic error here is permanent in a way a bug in the live path is not — the live path can
 * simply be fixed and the next call is right.
 */
describe("recompute", () => {
  it("recovers the cache-miss portion from a double-counted row", () => {
    // The buggy writer stored prompt_tokens + hits, and prompt_tokens already contained the hits.
    // A call with 9,000 prompt tokens of which 8,000 were cached was written as 17,000.
    expect(recompute({ inputTokens: 17_000, outputTokens: 300, cacheReadTokens: 8_000 }).inputTokens).toBe(9_000);
  });

  it("prices the recovered split at DeepSeek's published rates", () => {
    const { costAgorot } = recompute({ inputTokens: 17_000, outputTokens: 300, cacheReadTokens: 8_000 });
    const expectedUsd = (1_000 * 0.14 + 8_000 * 0.14 * 0.02 + 300 * 0.28) / 1_000_000;
    expect(costAgorot).toBe(Math.round(expectedUsd * 3.7 * 100));
  });

  it("leaves a row with no cache reads alone apart from the rate correction", () => {
    // Nothing was double-counted here, so the token count must not move — subtracting anything
    // would invent a discount on rows that never had one.
    expect(recompute({ inputTokens: 5_000, outputTokens: 100, cacheReadTokens: null }).inputTokens).toBe(5_000);
    expect(recompute({ inputTokens: 5_000, outputTokens: 100, cacheReadTokens: 0 }).inputTokens).toBe(5_000);
  });

  it("never produces negative tokens on rows that predate cache reporting", () => {
    // Naive subtraction goes negative on those, and a negative token count would corrupt every
    // total built on top of it.
    const { inputTokens, costAgorot } = recompute({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 900 });
    expect(inputTokens).toBeGreaterThanOrEqual(0);
    expect(costAgorot).toBeGreaterThanOrEqual(0);
  });

  it("only ever makes a cached-heavy row cheaper, never dearer", () => {
    // The whole point of the repair; if a corrected row came out higher, the sign is wrong.
    const { costAgorot } = recompute({ inputTokens: 11_000_000, outputTokens: 1_000_000, cacheReadTokens: 10_000_000 });
    expect(costAgorot).toBeLessThan(363); // what the old table produced for this shape
  });

  it("writes what the fixed live code would write for the same API response", async () => {
    // The load-bearing property: after the backfill, a repaired row and a fresh row describing the
    // same call must be indistinguishable. Otherwise the cost history has a seam exactly at the
    // deploy boundary — which is the first place anyone would look to check the repair worked.
    const promptTokens = 9_000_000; // large enough that agorot rounding doesn't hide a mismatch
    const hits = 8_000_000;
    const outputTokens = 300_000;

    const repaired = recompute({ inputTokens: promptTokens + hits, outputTokens, cacheReadTokens: hits });

    create.mockClear();
    await logClaudeUsage({
      businessId: "biz1",
      customerPhone: "972500000000",
      provider: "deepseek",
      model: "deepseek-chat",
      // What the fixed provider now reports: the miss portion, with hits separate.
      inputTokens: promptTokens - hits,
      cacheReadTokens: hits,
      outputTokens,
    });
    const live = create.mock.calls.at(-1)![0].data;

    expect(repaired.inputTokens).toBe(live.inputTokens);
    expect(repaired.costAgorot).toBe(live.costAgorot);
  });
});
