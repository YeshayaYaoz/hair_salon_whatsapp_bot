import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  apiUsageEvent: { create: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));

const { logClaudeUsage, logWhatsAppBillingEvent } = await import("./usageLedger.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("logClaudeUsage", () => {
  it("computes cost from plain input/output tokens using the model's published rate", async () => {
    await logClaudeUsage({
      businessId: "biz1",
      customerPhone: "0500000000",
      model: "claude-haiku-4-5-20251001",
      inputTokens: 1000,
      outputTokens: 500,
    });

    // Haiku: $1/MTok in, $5/MTok out -> (1000*1 + 500*5) / 1e6 = 0.0035 USD -> * 3.7 * 100 = 1.295 -> rounds to 1
    const call = mockPrisma.apiUsageEvent.create.mock.calls[0][0];
    expect(call.data.inputTokens).toBe(1000);
    expect(call.data.outputTokens).toBe(500);
    expect(call.data.costAgorot).toBe(1);
  });

  it("prices cache-write tokens at 1.25x and cache-read tokens at 0.1x the base input rate", async () => {
    await logClaudeUsage({
      businessId: "biz1",
      customerPhone: "0500000000",
      model: "claude-sonnet-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 10_000,
      cacheReadTokens: 10_000,
    });

    // Sonnet: $2/MTok base input.
    // cache write: 10000 * 2 * 1.25 / 1e6 = 0.025 USD
    // cache read:  10000 * 2 * 0.1  / 1e6 = 0.002 USD
    // total = 0.027 USD * 3.7 * 100 = 9.99 -> rounds to 10 agorot
    const call = mockPrisma.apiUsageEvent.create.mock.calls[0][0];
    expect(call.data.costAgorot).toBe(10);
  });

  it("folds cache-creation and cache-read tokens into the stored inputTokens total", async () => {
    await logClaudeUsage({
      businessId: "biz1",
      customerPhone: "0500000000",
      model: "claude-sonnet-5",
      inputTokens: 100,
      outputTokens: 0,
      cacheCreationTokens: 50,
      cacheReadTokens: 25,
    });

    const call = mockPrisma.apiUsageEvent.create.mock.calls[0][0];
    expect(call.data.inputTokens).toBe(175); // 100 + 50 + 25
  });

  it("stores a null cost (never a fabricated number) for an unrecognized model", async () => {
    await logClaudeUsage({
      businessId: "biz1",
      customerPhone: "0500000000",
      model: "some-future-model-not-in-the-price-table",
      inputTokens: 1000,
      outputTokens: 1000,
    });

    const call = mockPrisma.apiUsageEvent.create.mock.calls[0][0];
    expect(call.data.costAgorot).toBeNull();
  });

  // The provider comparison panel groups on `provider` and computes cache-hit rate from
  // cacheReadTokens/inputTokens — if these aren't persisted, that whole view reads as empty or
  // as 0% cache hits, which would look identical to caching being broken.
  it("persists the provider and the cache-token breakdown alongside the input total", async () => {
    await logClaudeUsage({
      businessId: "biz1",
      customerPhone: "0500000000",
      provider: "deepseek",
      model: "deepseek-chat",
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 40,
      cacheReadTokens: 900,
    });

    const call = mockPrisma.apiUsageEvent.create.mock.calls[0][0];
    expect(call.data.provider).toBe("deepseek");
    expect(call.data.cacheReadTokens).toBe(900);
    expect(call.data.cacheWriteTokens).toBe(40);
    // inputTokens stays the all-in total, so the two buckets must not be added on top of it.
    expect(call.data.inputTokens).toBe(1040);
  });

  it("tags the event kind as claude", async () => {
    await logClaudeUsage({
      businessId: "biz1",
      customerPhone: "0500000000",
      model: "claude-haiku-4-5-20251001",
      inputTokens: 10,
      outputTokens: 10,
    });
    expect(mockPrisma.apiUsageEvent.create.mock.calls[0][0].data.kind).toBe("claude");
  });
});

describe("logWhatsAppBillingEvent", () => {
  it("records the category/billable flag exactly as given, with no cost fabricated", async () => {
    await logWhatsAppBillingEvent({
      businessId: "biz1",
      customerPhone: "0500000000",
      category: "utility",
      billable: true,
    });

    const call = mockPrisma.apiUsageEvent.create.mock.calls[0][0];
    expect(call.data).toMatchObject({
      businessId: "biz1",
      customerPhone: "0500000000",
      kind: "whatsapp",
      category: "utility",
      billable: true,
    });
    expect(call.data.costAgorot).toBeUndefined();
  });
});
