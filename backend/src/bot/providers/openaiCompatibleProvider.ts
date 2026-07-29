import OpenAI, { APIError } from "openai";
import type { AiProvider, GenericTool, GenericTurn, GenericResponse, SystemPromptParts } from "./types.js";
import { ProviderCallError } from "./types.js";

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

const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503]);
const RETRY_DELAY_MS = 700;

function toOpenAiTools(tools: GenericTool[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

// OpenAI's chat-completions API wants one flat message array (system first), tool calls attached
// to the assistant message that requested them, and each tool result as its own separate
// role:"tool" message — a different shape from Anthropic's "tool_result content blocks grouped
// into one user message", hence this conversion instead of reusing toAnthropicMessages.
function toOpenAiMessages(system: SystemPromptParts, turns: GenericTurn[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  // OpenAI and DeepSeek both do automatic prefix caching rather than explicit breakpoints, so the
  // ordering still matters: the stable block goes first so it forms a cacheable prefix, and the
  // per-minute clock text trails it.
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: `${system.stable}\n${system.volatile}` },
  ];
  for (const turn of turns) {
    if (turn.role === "assistant") {
      messages.push({
        role: "assistant",
        content: turn.text || null,
        ...(turn.toolCalls?.length
          ? {
              tool_calls: turn.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: JSON.stringify(tc.input) },
              })),
            }
          : {}),
      });
      continue;
    }
    if (turn.toolResults?.length) {
      for (const r of turn.toolResults) messages.push({ role: "tool", tool_call_id: r.toolCallId, content: r.content });
      continue;
    }
    messages.push({ role: "user", content: turn.text ?? "" });
  }
  return messages;
}

function fromOpenAiResponse(response: OpenAI.Chat.ChatCompletion): GenericResponse {
  const choice = response.choices[0];
  const toolCalls = (choice.message.tool_calls ?? [])
    .filter((tc): tc is OpenAI.Chat.ChatCompletionMessageToolCall & { type: "function" } => tc.type === "function")
    .map((tc) => {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        // Malformed JSON from the model — pass through empty input rather than crashing the loop;
        // the tool implementation will reject missing required fields and the model can retry.
      }
      return { id: tc.id, name: tc.function.name, input };
    });
  // DeepSeek's OpenAI-compatible usage payload adds prompt_cache_hit_tokens/prompt_cache_miss_tokens
  // on top of the standard OpenAI fields — surface it as cacheReadTokens when present so its
  // context-caching discount shows up in cost tracking too, without this adapter needing to know
  // it's specifically talking to DeepSeek.
  const usageAny = response.usage as unknown as { prompt_cache_hit_tokens?: number } | undefined;
  return {
    text: choice.message.content?.trim() ?? "",
    toolCalls,
    stopReason: toolCalls.length > 0 ? "tool_use" : "end",
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      cacheReadTokens: usageAny?.prompt_cache_hit_tokens,
    },
  };
}

export function createOpenAiCompatibleProvider(config: {
  key: string;
  apiKeyEnvVar: string;
  baseURL?: string;
  defaultCheapModel: string;
  defaultSmartModel: string;
}): AiProvider {
  const apiKey = process.env[config.apiKeyEnvVar];
  const client = new OpenAI({ apiKey: apiKey || "missing", baseURL: config.baseURL });

  return {
    key: config.key,

    resolveModel(tier, override) {
      if (override) return override;
      return tier === "smart" ? config.defaultSmartModel : config.defaultCheapModel;
    },

    async send({ model, system, tools, turns }) {
      if (!apiKey) {
        throw new ProviderCallError(`${config.apiKeyEnvVar} is not configured on the server`, false);
      }
      const messages = toOpenAiMessages(system, turns);
      const openaiTools = toOpenAiTools(tools);

      const call = () => client.chat.completions.create({ model, max_tokens: 1024, temperature: TEMPERATURE, messages, tools: openaiTools });

      try {
        return fromOpenAiResponse(await call());
      } catch (err) {
        const retryable = err instanceof APIError ? RETRYABLE_STATUSES.has(err.status ?? 0) : true;
        if (!retryable) throw new ProviderCallError(err instanceof Error ? err.message : String(err), false);
        console.warn(`[${config.key}Provider] call failed (${err instanceof APIError ? err.status : "network"}), retrying once...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        try {
          return fromOpenAiResponse(await call());
        } catch (err2) {
          throw new ProviderCallError(err2 instanceof Error ? err2.message : String(err2), false);
        }
      }
    },
  };
}
