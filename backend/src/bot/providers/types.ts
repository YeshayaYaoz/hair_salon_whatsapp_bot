/**
 * Provider-agnostic shapes for the bot's tool-use loop. claudeBot.ts (the loop + tool
 * implementations) is written entirely against these types; each file in this directory adapts
 * one LLM backend's wire format to/from them. Conversation history persisted in conversationStore
 * is plain {role, text} already (see conversationStore.ts) — this layer only matters for the live,
 * single-request tool-calling loop, which is why the shapes below can stay this simple.
 */

export interface GenericTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface GenericToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** One turn in the live tool-use loop being built up within a single handleIncomingMessage call. */
export interface GenericTurn {
  role: "user" | "assistant";
  text?: string;
  toolCalls?: GenericToolCall[];
  toolResults?: { toolCallId: string; content: string }[];
}

export interface GenericUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export interface GenericResponse {
  text: string;
  toolCalls: GenericToolCall[];
  stopReason: "tool_use" | "end";
  usage: GenericUsage;
}

export interface AiProvider {
  /** Provider key as stored on Business.aiProvider — used for usage-ledger pricing lookups. */
  readonly key: string;
  /** Resolves the model id to bill/send: business.aiModel if set, else this provider's default
   * cheap or smart tier. */
  resolveModel(tier: "cheap" | "smart", override: string | null | undefined): string;
  send(params: { model: string; system: string; tools: GenericTool[]; turns: GenericTurn[] }): Promise<GenericResponse>;
}

export class ProviderCallError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "ProviderCallError";
  }
}
