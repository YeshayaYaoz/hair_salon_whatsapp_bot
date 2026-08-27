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

// "auto" is not a real backend (it's not in PROVIDERS/getAiProvider below) — claudeBot.ts resolves
// it to "anthropic" or "deepseek" per message based on chooseTier. It's a valid value to store on
// Business.aiProvider and to offer in the dashboard, which is why it's a separate list rather than
// a fourth entry in AI_PROVIDER_KEYS — code that iterates AI_PROVIDER_KEYS to actually call a
// provider (e.g. scripts/compare-providers.ts) would break if "auto" were mixed in there.
export const AI_PROVIDER_SELECTION_KEYS = ["auto", ...AI_PROVIDER_KEYS] as const;

export function isAiProviderKey(v: unknown): v is string {
  return typeof v === "string" && v in PROVIDERS;
}

/**
 * The provider to actually call for a stored preference.
 *
 * Falls back for two different reasons, and both matter:
 *
 *   - An unrecognised or legacy value (a business created before this field existed).
 *   - A provider this deployment has no key for. DeepSeek is the default for new businesses
 *     because it is far cheaper, but a deployment without DEEPSEEK_API_KEY would then have every
 *     new bot fail at send time with a server-configuration error the owner cannot act on.
 *     Falling back to a provider that IS configured keeps the bot answering; the Bot settings page
 *     still reports which providers are unconfigured, so the gap stays visible.
 */
export function getAiProvider(key: string | null | undefined): AiProvider {
  const chosen = (key && PROVIDERS[key]) || null;
  if (chosen?.isConfigured()) return chosen;
  if (chosen) {
    console.warn(`[providers] ${chosen.key} is selected but has no API key on this server — falling back.`);
  }
  // Cheapest first, so an unconfigured choice degrades toward lower cost rather than toward the
  // most expensive provider that happens to have a key.
  return (
    [PROVIDERS.deepseek, PROVIDERS.anthropic, PROVIDERS.openai].find((p) => p.isConfigured()) ??
    anthropicProvider
  );
}
