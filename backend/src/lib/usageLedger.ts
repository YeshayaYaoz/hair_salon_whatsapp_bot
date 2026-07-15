import { prisma } from "./prisma.js";

/**
 * Official Anthropic per-token pricing (USD per million tokens), source: platform.claude.com/docs
 * pricing page, checked July 2026. Sonnet 5 is on introductory pricing through 2026-08-31, then
 * reverts to the standard $3/$15 rate — update CLAUDE_PRICING_USD_PER_MTOK when that happens (or
 * sooner, if Anthropic changes rates). This is the only place a rate needs to change.
 */
const CLAUDE_PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 2, output: 10 }, // introductory rate through 2026-08-31
};

// USD→ILS is only needed to express cost in shekels next to ILS subscription revenue — update
// this if/when it's worth wiring to a live rate; a static rate here is far less consequential
// than fabricating a per-message cost, since it only scales an otherwise-exact token cost.
const USD_TO_ILS = 3.7;

/** Records the real token usage (and computed cost, from Anthropic's own published rates — no
 * estimate) of one actual Claude API call, so cost-per-phone-number is exact, not guessed. */
export async function logClaudeUsage(params: {
  businessId: string;
  customerPhone: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}) {
  const rate = CLAUDE_PRICING_USD_PER_MTOK[params.model];
  const costUsd = rate ? (params.inputTokens * rate.input + params.outputTokens * rate.output) / 1_000_000 : null;
  const costAgorot = costUsd !== null ? Math.round(costUsd * USD_TO_ILS * 100) : null;

  await prisma.apiUsageEvent.create({
    data: {
      businessId: params.businessId,
      customerPhone: params.customerPhone,
      kind: "claude",
      model: params.model,
      inputTokens: params.inputTokens,
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
