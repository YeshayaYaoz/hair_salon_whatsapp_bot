import { describe, it, expect } from "vitest";

/**
 * The merge rule from whatsappRoutes, stated once so the two constraints that force a split cannot
 * be lost in a refactor. The owner's own line produced the bug this fixes: a single "שלום" was
 * answered with the welcome and then "שלום! איך אפשר לעזור לך?" as a second message — a bot
 * talking to itself.
 */
const INTERACTIVE_BODY_LIMIT = 1024;

function shouldMerge(o: {
  greetingText?: string;
  greetingSeparateMessage: boolean;
  hasGreetingButton: boolean;
  willBeInteractive: boolean;
  replyLength: number;
}): boolean {
  if (!o.greetingText) return false;
  if (o.greetingSeparateMessage) return false;
  if (o.hasGreetingButton) return false;
  const merged = o.greetingText.length + 2 + o.replyLength;
  return !o.willBeInteractive || merged <= INTERACTIVE_BODY_LIMIT;
}

const base = {
  greetingText: "שלום וברכה! שמחים שפנית אלינו.",
  greetingSeparateMessage: false,
  hasGreetingButton: false,
  willBeInteractive: true,
  replyLength: 30,
};

describe("greeting merge rule", () => {
  it("merges by default, which is the whole point", () => {
    expect(shouldMerge(base)).toBe(true);
  });

  it("splits when the owner asked for two messages", () => {
    expect(shouldMerge({ ...base, greetingSeparateMessage: true })).toBe(false);
  });

  it("splits when a link button is configured, because one message holds one button type", () => {
    // Merging here would silently drop either the owner's link or the quick replies.
    expect(shouldMerge({ ...base, hasGreetingButton: true })).toBe(false);
  });

  it("splits rather than let a long welcome be trimmed to 1024 mid-sentence", () => {
    const long = "א".repeat(1100);
    expect(shouldMerge({ ...base, greetingText: long })).toBe(false);
  });

  it("still merges a long welcome when no interactive body limit applies", () => {
    const long = "א".repeat(1100);
    expect(shouldMerge({ ...base, greetingText: long, willBeInteractive: false })).toBe(true);
  });

  it("does nothing when there is no welcome to merge", () => {
    expect(shouldMerge({ ...base, greetingText: undefined })).toBe(false);
  });
});
