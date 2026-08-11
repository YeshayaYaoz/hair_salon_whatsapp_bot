import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => {
  class FakeAPIError extends Error {
    status?: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    default: class {
      chat = { completions: { create: mockCreate } };
    },
    APIError: FakeAPIError,
  };
});

const { createOpenAiCompatibleProvider } = await import("./openaiCompatibleProvider.js");

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TEST_PROVIDER_KEY = "sk-test";
});

function makeProvider() {
  return createOpenAiCompatibleProvider({
    key: "testprov",
    apiKeyEnvVar: "TEST_PROVIDER_KEY",
    defaultCheapModel: "cheap-model",
    defaultSmartModel: "smart-model",
  });
}

describe("openaiCompatibleProvider", () => {
  it("resolves the default cheap/smart model when no override is set", () => {
    const provider = makeProvider();
    expect(provider.resolveModel("cheap", null)).toBe("cheap-model");
    expect(provider.resolveModel("smart", undefined)).toBe("smart-model");
  });

  it("always returns an explicit model override regardless of tier", () => {
    const provider = makeProvider();
    expect(provider.resolveModel("cheap", "gpt-4o")).toBe("gpt-4o");
    expect(provider.resolveModel("smart", "gpt-4o")).toBe("gpt-4o");
  });

  it("parses a plain text response with no tool calls as stopReason 'end'", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "Hello there", tool_calls: undefined } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
    const provider = makeProvider();
    const res = await provider.send({ model: "cheap-model", system: { stable: "stable-part", volatile: "volatile-part" }, tools: [], turns: [{ role: "user", text: "hi" }] });
    expect(res.stopReason).toBe("end");
    expect(res.text).toBe("Hello there");
    expect(res.toolCalls).toEqual([]);
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: undefined });
  });

  it("parses tool calls and their JSON arguments into GenericToolCall shape", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "check_availability", arguments: '{"serviceName":"Haircut","date":"2026-08-01"}' } },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    });
    const provider = makeProvider();
    const res = await provider.send({ model: "cheap-model", system: { stable: "stable-part", volatile: "volatile-part" }, tools: [], turns: [] });
    expect(res.stopReason).toBe("tool_use");
    expect(res.toolCalls).toEqual([{ id: "call_1", name: "check_availability", input: { serviceName: "Haircut", date: "2026-08-01" } }]);
  });

  it("falls back to empty input for malformed tool-call JSON instead of throwing", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "book_appointment", arguments: "{not valid json" } }] } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const provider = makeProvider();
    const res = await provider.send({ model: "cheap-model", system: { stable: "stable-part", volatile: "volatile-part" }, tools: [], turns: [] });
    expect(res.toolCalls).toEqual([{ id: "call_1", name: "book_appointment", input: {} }]);
  });

  it("surfaces DeepSeek-style prompt_cache_hit_tokens as cacheReadTokens", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "ok", tool_calls: undefined } }],
      usage: { prompt_tokens: 200, completion_tokens: 30, prompt_cache_hit_tokens: 150 },
    });
    const provider = makeProvider();
    const res = await provider.send({ model: "deepseek-chat", system: { stable: "stable-part", volatile: "volatile-part" }, tools: [], turns: [] });
    expect(res.usage.cacheReadTokens).toBe(150);
    // prompt_tokens is the TOTAL prompt including the cache hits, where Anthropic's input_tokens
    // excludes them. Reporting it whole billed the 150 cached tokens twice — once at the full input
    // rate and again as a cache read — which made a well-cached DeepSeek call look about as
    // expensive as an uncached one in the cost dashboard.
    expect(res.usage.inputTokens).toBe(50);
  });

  it("reads OpenAI's prompt_tokens_details.cached_tokens the same way", async () => {
    // This adapter serves OpenAI too, and OpenAI reports its automatic caching in a different
    // field again. Missing it billed every cached OpenAI token at the full input rate — the third
    // instance of the same bug (DeepSeek here, Anthropic in the voice agent's reporter).
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "ok", tool_calls: undefined } }],
      usage: { prompt_tokens: 200, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 150 } },
    });
    const provider = makeProvider();
    const res = await provider.send({ model: "gpt-4o-mini", system: { stable: "stable-part", volatile: "volatile-part" }, tools: [], turns: [] });
    expect(res.usage.cacheReadTokens).toBe(150);
    expect(res.usage.inputTokens).toBe(50);
  });

  // Ordering is the whole point of splitting the system prompt: the stable block must form the
  // cacheable prefix, with the per-minute clock text trailing it. Reversing these silently
  // destroys prefix caching (which is exactly the bug this split was introduced to fix), and
  // nothing else in the suite would notice.
  it("puts the stable system block before the volatile one so it forms a cacheable prefix", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "ok", tool_calls: undefined } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const provider = makeProvider();
    await provider.send({ model: "cheap-model", system: { stable: "STABLE", volatile: "VOLATILE" }, tools: [], turns: [] });

    const sent = mockCreate.mock.calls[0][0].messages[0];
    expect(sent.role).toBe("system");
    expect(sent.content.indexOf("STABLE")).toBeLessThan(sent.content.indexOf("VOLATILE"));
  });

  it("throws a non-retryable ProviderCallError when the API key env var is unset", async () => {
    delete process.env.TEST_PROVIDER_KEY;
    const provider = createOpenAiCompatibleProvider({
      key: "testprov",
      apiKeyEnvVar: "TEST_PROVIDER_KEY",
      defaultCheapModel: "cheap-model",
      defaultSmartModel: "smart-model",
    });
    await expect(provider.send({ model: "cheap-model", system: { stable: "stable-part", volatile: "volatile-part" }, tools: [], turns: [] })).rejects.toMatchObject({
      name: "ProviderCallError",
      retryable: false,
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("retries once on a retryable status and succeeds on the second attempt", async () => {
    const { APIError } = await import("openai");
    mockCreate
      .mockRejectedValueOnce(new APIError(503, "overloaded"))
      .mockResolvedValueOnce({ choices: [{ message: { content: "recovered", tool_calls: undefined } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const provider = makeProvider();
    const res = await provider.send({ model: "cheap-model", system: { stable: "stable-part", volatile: "volatile-part" }, tools: [], turns: [] });
    expect(res.text).toBe("recovered");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  }, 3000);
});
