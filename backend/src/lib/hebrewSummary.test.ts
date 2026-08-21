import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { toHebrewSummary } from "./hebrewSummary.js";

/**
 * The invariant under test is fail-open: a summary in English is strictly better than no summary,
 * so no failure mode — missing key, network error, empty model reply — may turn real text into
 * null. The dashboard bug this fixes was language, and losing the summary entirely would be a
 * worse bug wearing the fix's name.
 */
describe("toHebrewSummary", () => {
  const KEY = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  afterEach(() => {
    if (KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = KEY;
  });

  it("returns null for empty input", async () => {
    expect(await toHebrewSummary(null)).toBeNull();
    expect(await toHebrewSummary("")).toBeNull();
    expect(await toHebrewSummary("   ")).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("passes Hebrew through untouched, without calling the model", async () => {
    const s = "הלקוחה ביקשה תור לצבע ביום שלישי";
    expect(await toHebrewSummary(s)).toBe(s);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("passes mixed Hebrew/English through — re-translating Hebrew loses nuance", async () => {
    const s = "שולי מעוניינת ביחידת Deluxe לראש השנה";
    expect(await toHebrewSummary(s)).toBe(s);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("translates English", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "הלקוח ביקש תספורת מחר" }] });
    expect(await toHebrewSummary("The caller asked for a haircut tomorrow.")).toBe("הלקוח ביקש תספורת מחר");
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("keeps the original when the API key is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await toHebrewSummary("English summary")).toBe("English summary");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("keeps the original when the model call fails", async () => {
    mockCreate.mockRejectedValue(new Error("overloaded"));
    expect(await toHebrewSummary("English summary")).toBe("English summary");
  });

  it("keeps the original when the model returns nothing usable", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "  " }] });
    expect(await toHebrewSummary("English summary")).toBe("English summary");
  });
});
