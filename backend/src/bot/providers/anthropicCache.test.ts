import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { withCacheBreakpoint } from "./anthropicProvider.js";

/**
 * The messages array was the one uncached part of the request, so every call in the tool loop
 * re-billed the whole conversation at full price. These lock in that the breakpoint lands in the
 * one place that helps — the very end — and nowhere else.
 */
describe("withCacheBreakpoint", () => {
  const cc = { type: "ephemeral" } as const;

  it("marks the final block of the final message", () => {
    const out = withCacheBreakpoint([
      { role: "user", content: [{ type: "text", text: "שלום" }] },
      { role: "assistant", content: [{ type: "text", text: "היי" }] },
    ]);
    expect((out[1].content as any)[0].cache_control).toEqual(cc);
  });

  it("leaves every earlier message untouched — extra breakpoints cost writes for nothing", () => {
    const out = withCacheBreakpoint([
      { role: "user", content: [{ type: "text", text: "a" }] },
      { role: "assistant", content: [{ type: "text", text: "b" }] },
      { role: "user", content: [{ type: "text", text: "c" }] },
    ]);
    expect((out[0].content as any)[0].cache_control).toBeUndefined();
    expect((out[1].content as any)[0].cache_control).toBeUndefined();
  });

  it("marks only the last block when the message has several", () => {
    const out = withCacheBreakpoint([
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "{}" },
          { type: "tool_result", tool_use_id: "t2", content: "{}" },
        ],
      },
    ]);
    const blocks = out[0].content as any[];
    expect(blocks[0].cache_control).toBeUndefined();
    expect(blocks[1].cache_control).toEqual(cc);
  });

  it("promotes a plain-string message to block form so it can carry the breakpoint", () => {
    const out = withCacheBreakpoint([{ role: "user", content: "מתי אתם פתוחים?" }]);
    expect(out[0].content).toEqual([{ type: "text", text: "מתי אתם פתוחים?", cache_control: cc }]);
  });

  it("does not mutate the input", () => {
    const input: Anthropic.MessageParam[] = [{ role: "user", content: [{ type: "text", text: "x" }] }];
    withCacheBreakpoint(input);
    expect((input[0].content as any)[0].cache_control).toBeUndefined();
  });

  it("handles an empty array rather than throwing on the first call of a conversation", () => {
    expect(withCacheBreakpoint([])).toEqual([]);
  });
});
