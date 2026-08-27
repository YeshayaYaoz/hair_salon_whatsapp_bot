import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type { AiProvider, GenericTool, GenericTurn, GenericResponse } from "./types.js";
import { ProviderCallError, DEFAULT_TEMPERATURE } from "./types.js";

// maxRetries: 0 here because we do our own retry below — that lets us log each attempt and
// control the backoff explicitly, rather than relying on the SDK's opaque internal retry (which
// also doesn't cover Anthropic's "overloaded" (529) status).
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });

const MODEL_CHEAP = "claude-haiku-4-5-20251001";
const MODEL_SMART = "claude-sonnet-5";



/**
 * Newer Anthropic models reject `temperature` outright — the API answers
 * `400 invalid_request_error: "temperature is deprecated for this model"`. That took the bot down
 * completely on claude-sonnet-5: every call 400'd, including the Haiku fallback path's own retry,
 * so customers got "the bot is unavailable" for every message.
 *
 * Rather than hardcode a model list that goes stale the next time a model ships, the parameter is
 * sent optimistically and dropped on the one specific error that says it isn't accepted. The
 * result is cached per model id so it costs one failed call per model per process, not per message.
 */
const temperatureRejected = new Set<string>();

/** Whether this model has already answered "temperature is deprecated" once in this process. The
 * dashboard reads this so the temperature slider can say it has no effect instead of pretending. */
export function anthropicRejectsTemperature(model: string): boolean {
  return temperatureRejected.has(model);
}

function isTemperatureRejection(err: unknown): boolean {
  return err instanceof APIError && err.status === 400 && /temperature/i.test(err.message);
}

/** Keeps the HTTP status and model id in the message: a 404 (model not enabled for this account)
 * and a 529 (overloaded) look identical once flattened to a bare string, but need opposite fixes. */
function providerError(err: unknown, model: string): ProviderCallError {
  const status = err instanceof APIError ? err.status : undefined;
  const detail = err instanceof Error ? err.message : String(err);
  return new ProviderCallError(`[${model}]${status ? ` HTTP ${status}` : ""} ${detail}`, false);
}

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

/**
 * Marks the end of the conversation as a cache breakpoint.
 *
 * The system prompt and tool definitions were already cached, but the messages were not — so every
 * call re-billed the whole history at full price. That is the part that actually grows: sixteen
 * turns plus tool results (availability listings, price lookups) are resent on every single call,
 * and one customer message costs two or three calls because of the tool loop.
 *
 * The breakpoint goes on the last block, so each call caches the prefix the *next* call will read.
 * That costs a cache write (1.25x) on content that would otherwise be billed at 1x, which only pays
 * off if a later call reads it — and inside a tool loop, two to three calls land seconds apart on a
 * strictly growing prefix, so it does. Across a conversation the same prefix is read again on every
 * follow-up message within the cache's five-minute window.
 *
 * Anthropic allows four breakpoints; this is the third (tools, system, messages).
 */
export function withCacheBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const last = messages[messages.length - 1];
  if (!last) return messages;

  // A plain-string message has no block to attach cache_control to — promote it to block form.
  const blocks: Anthropic.ContentBlockParam[] =
    typeof last.content === "string"
      ? [{ type: "text", text: last.content }]
      : [...(last.content as Anthropic.ContentBlockParam[])];
  if (blocks.length === 0) return messages;

  const tail = blocks[blocks.length - 1];
  blocks[blocks.length - 1] = { ...tail, cache_control: { type: "ephemeral" } } as Anthropic.ContentBlockParam;
  return [...messages.slice(0, -1), { ...last, content: blocks }];
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
  isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY?.trim()),

  resolveModel(tier, override) {
    if (override) return override;
    return tier === "smart" ? MODEL_SMART : MODEL_CHEAP;
  },

  async send({ model, system, tools, turns, temperature }) {
    // Two system blocks: the cache breakpoint sits on the stable one, so the per-minute clock
    // text in `volatile` trails it and never invalidates the cached prefix.
    const cachedSystem: Anthropic.TextBlockParam[] = [
      { type: "text", text: system.stable, cache_control: { type: "ephemeral" } },
      { type: "text", text: system.volatile },
    ];
    const anthropicTools = toAnthropicTools(tools);
    const messages = withCacheBreakpoint(toAnthropicMessages(turns));

    const call = () =>
      anthropic.messages.create({
        model,
        max_tokens: 1024,
        ...(temperatureRejected.has(model) ? {} : { temperature: temperature ?? DEFAULT_TEMPERATURE }),
        system: cachedSystem,
        tools: anthropicTools,
        messages,
      });

    try {
      return fromAnthropicResponse(await call());
    } catch (err) {
      // Retry immediately without temperature, and remember for every later call on this model.
      if (isTemperatureRejection(err) && !temperatureRejected.has(model)) {
        console.warn(`[anthropicProvider] ${model} rejects temperature — retrying without it and dropping it from now on`);
        temperatureRejected.add(model);
        try {
          return fromAnthropicResponse(await call());
        } catch (err2) {
          throw providerError(err2, model);
        }
      }
      const retryable = err instanceof APIError ? RETRYABLE_STATUSES.has(err.status ?? 0) : true;
      if (!retryable) throw providerError(err, model);
      console.warn(`[anthropicProvider] call failed (${err instanceof APIError ? err.status : "network"}), retrying once...`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      try {
        return fromAnthropicResponse(await call());
      } catch (err2) {
        throw providerError(err2, model);
      }
    }
  },
};

// Exported so claudeBot.ts's cheap/smart escalation check (which currently compares model ids
// directly) keeps working without hardcoding these strings in two places.
export { MODEL_CHEAP as ANTHROPIC_MODEL_CHEAP, MODEL_SMART as ANTHROPIC_MODEL_SMART };
