import { describe, it, expect } from "vitest";
import { trimToLimit } from "./whatsappClient.js";

const ZWJ = "‍";
const VS16 = "️";

/**
 * WhatsApp enforces its length limits by rejecting the send, so these strings are trimmed before
 * they leave. Trimming with slice() counts UTF-16 code units — an emoji is two of them, and a body
 * landing exactly on one used to be cut in half and delivered as a replacement glyph.
 */
describe("trimToLimit", () => {
  it("leaves anything within the limit alone", () => {
    expect(trimToLimit("שלום", 20)).toBe("שלום");
    expect(trimToLimit("", 20)).toBe("");
  });

  it("trims plain text to the limit", () => {
    expect(trimToLimit("abcdefghij", 4)).toBe("abcd");
  });

  it("never splits an emoji in half", () => {
    // "ab😊" is 4 code units. Cutting at 3 lands between the surrogates.
    const out = trimToLimit("ab😊", 3);
    expect(out).toBe("ab");
    expect(out).not.toMatch(/[\uD800-\uDFFF]/); // no lone surrogate left behind
  });

  it("keeps a whole emoji when it fits exactly", () => {
    expect(trimToLimit("ab😊cd", 4)).toBe("ab😊");
  });

  it("drops a joiner left with nothing to join to", () => {
    // Cutting a ZWJ sequence mid-way would otherwise end the message on a dangling joiner.
    const family = `👨${ZWJ}👩${ZWJ}👧`;
    const out = trimToLimit(`hi ${family}`, 6);
    expect(out.endsWith(ZWJ)).toBe(false);
    expect(out).toBe("hi 👨");
  });

  it("drops a trailing variation selector", () => {
    const out = trimToLimit(`ab😊${VS16}cd`, 5);
    expect(out.endsWith(VS16)).toBe(false);
    expect(out).toBe("ab😊");
  });

  it("counts in the units WhatsApp counts, so a trimmed string is never over the limit", () => {
    const emojiHeavy = "😊".repeat(50);
    expect(trimToLimit(emojiHeavy, 20).length).toBeLessThanOrEqual(20);
  });
});
