import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type { AiProvider, GenericTool, GenericTurn, GenericResponse } from "./types.js";
import { ProviderCallError } from "./types.js";

// maxRetries: 0 here because we do our own retry below — that lets us log each attempt and
// control the backoff explicitly, rather than relying on the SDK's opaque internal retry (which
// also doesn't cover Anthropic's "overloaded" (529) status).
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });

const MODEL_CHEAP = "claude-haiku-4-5-20251001";
const MODEL_SMART = "claude-sonnet-5";

/**
 * Low temperature, deliberately.
 *
 * This was previously unset, so it defaulted to maximum sampling variability — which is what
 * produced invented Hebrew: the model would sample a novel phrasing instead of the fixed idiom,
 * e.g. "מבורך הבא" in place of "ברוך הבא". Hebrew is full of fixed collocations where any variation
 * is simply wrong, and nothing this bot does benefits from linguistic invention: it quotes prices,
 * offers times, and confirms bookings. Not 0, so identical repeated questions don't produce
 * word-for-word identical replies, which reads robotic in a chat thread.
 */
const TEMPERATURE = 0.2;

const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 529]);
const RETRY_DELAY_MS = 700;

function toAnthropicTools(tools: GenericTool[]): Anthropic.Tool[] {
  // Prompt caching: tool definitions are identical across calls in the same turn/business, so
  // marking the last one as a cache breakpoint lets Anthropic skip re-billing the unchanged
  // prefix on every turn. Minimum cacheable prefix is 1024 tokens on Sonnet, 4096 on Haiku 4.5 —
  // below that Anthropic silently skips caching rather than erroring; nothing breaks either way.
  return tools.map((t, i) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    ...(i === tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}

function toAnthropicMessages(turns: GenericTurn[]): Anthropic.MessageParam[] {
  return turns.map((turn) => {
    if (turn.role === "assistant") {
      const content: Anthropic.ContentBlockParam[] = [];
      if (turn.text) content.push({ type: "text", text: turn.text });
      for (const tc of turn.toolCalls ?? []) content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
      return { role: "assistant", content };
    }
    if (turn.toolResults?.length) {
      const content: Anthropic.ToolResultBlockParam[] = turn.toolResults.map((r) => ({
        type: "tool_result",
        tool_use_id: r.toolCallId,
        content: r.content,
      }));
      return { role: "user", content };
    }
    return { role: "user", content: turn.text ?? "" };
  });
}

function fromAnthropicResponse(response: Anthropic.Message): GenericResponse {
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  const toolCalls = response.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> }));
  return {
    text,
    toolCalls,
    stopReason: response.stop_reason === "tool_use" ? "tool_use" : "end",
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? undefined,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
    },
  };
}

export const anthropicProvider: AiProvider = {
  key: "anthropic",

  resolveModel(tier, override) {
    if (override) return override;
    return tier === "smart" ? MODEL_SMART : MODEL_CHEAP;
  },

  async send({ model, system, tools, turns }) {
    // Two system blocks: the cache breakpoint sits on the stable one, so the per-minute clock
    // text in `volatile` trails it and never invalidates the cached prefix.
    const cachedSystem: Anthropic.TextBlockParam[] = [
      { type: "text", text: system.stable, cache_control: { type: "ephemeral" } },
      { type: "text", text: system.volatile },
    ];
    const anthropicTools = toAnthropicTools(tools);
    const messages = toAnthropicMessages(turns);

    const call = () => anthropic.messages.create({ model, max_tokens: 1024, temperature: TEMPERATURE, system: cachedSystem, tools: anthropicTools, messages });

    try {
      return fromAnthropicResponse(await call());
    } catch (err) {
      const retryable = err instanceof APIError ? RETRYABLE_STATUSES.has(err.status ?? 0) : true;
      if (!retryable) throw new ProviderCallError(err instanceof Error ? err.message : String(err), false);
      console.warn(`[anthropicProvider] call failed (${err instanceof APIError ? err.status : "network"}), retrying once...`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      try {
        return fromAnthropicResponse(await call());
      } catch (err2) {
        throw new ProviderCallError(err2 instanceof Error ? err2.message : String(err2), false);
      }
    }
  },
};

// Exported so claudeBot.ts's cheap/smart escalation check (which currently compares model ids
// directly) keeps working without hardcoding these strings in two places.
export { MODEL_CHEAP as ANTHROPIC_MODEL_CHEAP, MODEL_SMART as ANTHROPIC_MODEL_SMART };
