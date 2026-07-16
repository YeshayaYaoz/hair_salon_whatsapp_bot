import { describe, it, expect } from "vitest";
import { nameSimilarity } from "./matching.js";

describe("nameSimilarity", () => {
  it("scores an exact match at 100", () => {
    expect(nameSimilarity("מספרת שרה", "מספרת שרה")).toBe(100);
  });

  it("scores an exact match at 100 even with different casing/spacing (post-normalize)", () => {
    expect(nameSimilarity("Dana Salon", "  DANA   salon  ")).toBe(100);
  });

  it("treats an apostrophe as a word boundary, not just stripped punctuation", () => {
    // "Dana's" normalizes to "dana s" (two tokens) — a real, if surprising, normalize() behavior
    // worth pinning down in a test rather than rediscovering it via a wrong assumption later.
    expect(nameSimilarity("Dana's Salon", "Danas Salon")).toBeLessThan(100);
  });

  it("scores a partial word overlap between 0 and 100", () => {
    // "מספרת שרה" (2 words) vs "מספרת שרה בע"מ" (3 distinct words after normalize) — 2 shared / 3 union = 67
    const score = nameSimilarity("מספרת שרה", 'מספרת שרה בע"מ');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
    expect(score).toBe(67);
  });

  it("scores completely unrelated names at 0", () => {
    expect(nameSimilarity("מספרת שרה", "קליניקת יופי דנה")).toBe(0);
  });

  it("returns 0 for an empty name rather than throwing", () => {
    expect(nameSimilarity("", "מספרת שרה")).toBe(0);
    expect(nameSimilarity("מספרת שרה", "")).toBe(0);
    expect(nameSimilarity("", "")).toBe(0);
  });

  it("is symmetric — order of arguments doesn't change the score", () => {
    expect(nameSimilarity("מספרת שרה", 'מספרת שרה בע"מ')).toBe(nameSimilarity('מספרת שרה בע"מ', "מספרת שרה"));
  });

  it("ignores single-character tokens when computing word overlap", () => {
    // A lone "-" or single letter shouldn't inflate the match — both sides here share only the
    // real word "סלון", not any stray single-char token left over after punctuation stripping.
    const score = nameSimilarity("סלון א", "סלון ב");
    expect(score).toBe(100); // both single-char tokens get filtered out, leaving "סלון" == "סלון"
  });
});
