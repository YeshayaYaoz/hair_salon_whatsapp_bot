import type { AiProvider } from "./types.js";
import { anthropicProvider } from "./anthropicProvider.js";
import { createOpenAiCompatibleProvider } from "./openaiCompatibleProvider.js";

export type { AiProvider, GenericTool, GenericTurn, GenericToolCall, GenericResponse, GenericUsage } from "./types.js";
export { ProviderCallError } from "./types.js";

const openaiProvider = createOpenAiCompatibleProvider({
  key: "openai",
  apiKeyEnvVar: "OPENAI_API_KEY",
  defaultCheapModel: "gpt-4o-mini",
  defaultSmartModel: "gpt-4o",
});

// Both tiers deliberately point at deepseek-chat. deepseek-reasoner is the stronger model, but
// DeepSeek documents it as not supporting function calling — and this bot is entirely tool-driven
// (check_availability / book_appointment / ...), so routing to it would not merely degrade replies,
// it would break booking outright. Revisit only after confirming tool support against a live key;
// until then the tool-capable model is the only safe choice on this provider.
const deepseekProvider = createOpenAiCompatibleProvider({
  key: "deepseek",
  apiKeyEnvVar: "DEEPSEEK_API_KEY",
  baseURL: "https://api.deepseek.com",
  defaultCheapModel: "deepseek-chat",
  defaultSmartModel: "deepseek-chat",
});

const PROVIDERS: Record<string, AiProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  deepseek: deepseekProvider,
};

export const AI_PROVIDER_KEYS = ["anthropic", "openai", "deepseek"] as const;

export function isAiProviderKey(v: unknown): v is string {
  return typeof v === "string" && v in PROVIDERS;
}

/** Falls back to Anthropic for any unrecognized/legacy value (including businesses created before
 * this field existed, which default to "anthropic" at the DB level anyway). */
export function getAiProvider(key: string | null | undefined): AiProvider {
  return (key && PROVIDERS[key]) || anthropicProvider;
}
