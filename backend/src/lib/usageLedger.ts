import { prisma } from "./prisma.js";

/**
 * Published per-token pricing (USD per million tokens) across every LLM backend the bot can run
 * on — Anthropic (platform.claude.com/docs pricing page), OpenAI (openai.com/api/pricing), and
 * DeepSeek (api-docs.deepseek.com/quick_start/pricing), all checked July 2026. Sonnet 5 is on
 * introductory pricing through 2026-08-31, then reverts to the standard $3/$15 rate — update here
 * when that happens (or sooner, if any provider changes rates). This is the only place a rate
 * needs to change. Keyed by model id alone (not provider+model) since ids are unique across
 * providers already.
 */
interface ModelRate {
  input: number;
  output: number;
  /**
   * Cache-read price as a fraction of the input rate, when the provider's discount differs from
   * Anthropic's. Anthropic bills a cache read at 0.1× input; DeepSeek bills it at roughly 0.02×
   * (published as $0.0028 against $0.14), so applying Anthropic's multiplier to DeepSeek overstated
   * every cached token five-fold.
   */
  cacheReadMultiplier?: number;
}

const CLAUDE_PRICING_USD_PER_MTOK: Record<string, ModelRate> = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 2, output: 10 }, // introductory rate through 2026-08-31
  // OpenAI caches long prompts automatically and bills cached reads at half the input rate
  // ($0.075 against $0.15, $1.25 against $2.50 — checked August 2026). Without the multiplier the
  // default (Anthropic's 0.1x) would understate every cached OpenAI token five-fold.
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheReadMultiplier: 0.5 },
  "gpt-4o": { input: 2.5, output: 10, cacheReadMultiplier: 0.5 },
  // Checked against DeepSeek's published rates, August 2026: $0.14 cache-miss input, $0.0028
  // cache-hit input, $0.28 output. Previously $0.28/$0.42 entered from memory, which overstated
  // input 2× and output 1.5× on top of the cache errors.
  //
  // Note: the "deepseek-chat" alias is documented as deprecating in favour of the V4 models. When
  // it moves, these rates move with it — the alias will keep working while quietly billing at the
  // new model's price, so this is worth re-checking rather than trusting to stay put.
  "deepseek-chat": { input: 0.14, output: 0.28, cacheReadMultiplier: 0.02 },
};

// USD→ILS is only needed to express cost in shekels next to ILS subscription revenue — update
// this if/when it's worth wiring to a live rate; a static rate here is far less consequential
// than fabricating a per-message cost, since it only scales an otherwise-exact token cost.
const USD_TO_ILS = 3.7;

// Prompt-caching billing multipliers on top of the base input rate — official, published, and
// fixed regardless of model (only the base input rate above varies by model). A cache write costs
// MORE than a plain input token (you're paying to populate the cache); a cache read costs much
// LESS (that's the whole point). Both are still real input tokens Anthropic bills for, so both
// must be counted for the cost to stay exact — see cache_control usage in claudeBot.ts.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/** Records the real token usage (and computed cost, from Anthropic's own published rates — no
 * estimate) of one actual Claude API call, so cost-per-phone-number is exact, not guessed.
 * inputTokens here is the plain (non-cached) portion only — cacheCreationTokens/cacheReadTokens
 * are the other two buckets Anthropic reports separately once prompt caching is in use. */
export async function logClaudeUsage(params: {
  businessId: string;
  customerPhone: string;
  /** "anthropic" | "openai" | "deepseek" — optional so older callers/tests stay valid. */
  provider?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}) {
  const rate = CLAUDE_PRICING_USD_PER_MTOK[params.model];
  const costUsd = rate
    ? (params.inputTokens * rate.input +
        params.outputTokens * rate.output +
        (params.cacheCreationTokens ?? 0) * rate.input * CACHE_WRITE_MULTIPLIER +
        (params.cacheReadTokens ?? 0) * rate.input * (rate.cacheReadMultiplier ?? CACHE_READ_MULTIPLIER)) /
      1_000_000
    : null;
  const costAgorot = costUsd !== null ? Math.round(costUsd * USD_TO_ILS * 100) : null;
  const totalInputTokens = params.inputTokens + (params.cacheCreationTokens ?? 0) + (params.cacheReadTokens ?? 0);

  await prisma.apiUsageEvent.create({
    data: {
      businessId: params.businessId,
      customerPhone: params.customerPhone,
      kind: "claude",
      provider: params.provider,
      model: params.model,
      inputTokens: totalInputTokens,
      cacheReadTokens: params.cacheReadTokens,
      cacheWriteTokens: params.cacheCreationTokens,
      outputTokens: params.outputTokens,
      costAgorot,
    },
  });
}

/** Records one real WhatsApp message-billing event exactly as Meta's status webhook reported it
 * (category + billable flag) — no fabricated shekel amount, since Meta only exposes the actual
 * per-message price on the account's invoice, not in the webhook payload. */
export async function logWhatsAppBillingEvent(params: {
  businessId: string;
  customerPhone: string;
  category: string;
  billable: boolean;
}) {
  await prisma.apiUsageEvent.create({
    data: {
      businessId: params.businessId,
      customerPhone: params.customerPhone,
      kind: "whatsapp",
      category: params.category,
      billable: params.billable,
    },
  });
}
