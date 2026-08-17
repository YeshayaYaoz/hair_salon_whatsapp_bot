import { describe, it, expect } from "vitest";
import { normalizeSpokenEmail } from "./spokenEmail.js";

describe("normalizeSpokenEmail", () => {
  // The call this was written for: photos asked for by email, address given out loud, nothing sent.
  it("reads the address a Hebrew speaker actually says", () => {
    expect(normalizeSpokenEmail("yeshaya שטרודל ג'ימייל נקודה קום")).toBe("yeshaya@gmail.com");
  });

  it("handles the separators without spaces around them", () => {
    expect(normalizeSpokenEmail("dana שטרודלwalla נקודהco נקודהil")).toBe("dana@walla.co.il");
  });

  it("knows the other separator words", () => {
    expect(normalizeSpokenEmail("a קו תחתון b שטרודל gmail נקודה com")).toBe("a_b@gmail.com");
    expect(normalizeSpokenEmail("a מקף b שטרודל gmail נקודה com")).toBe("a-b@gmail.com");
    expect(normalizeSpokenEmail("a פלוס b שטרודל gmail נקודה com")).toBe("a+b@gmail.com");
  });

  it("knows the providers by their Hebrew names", () => {
    expect(normalizeSpokenEmail("x שטרודל הוטמייל נקודה קום")).toBe("x@hotmail.com");
    expect(normalizeSpokenEmail("x שטרודל יאהו נקודה קום")).toBe("x@yahoo.com");
    expect(normalizeSpokenEmail("x שטרודל וואלה נקודה קו נקודה איי אל")).toBeNull(); // "איי אל" is not decoded — see below
  });

  // Not ambiguous, and rejecting it reproduces exactly the failure this exists to remove.
  it("completes a provider the caller stopped at", () => {
    expect(normalizeSpokenEmail("yeshaya שטרודל gmail")).toBe("yeshaya@gmail.com");
    expect(normalizeSpokenEmail("dana שטרודל וואלה")).toBe("dana@walla.co.il");
  });

  // A domain nobody can complete from a name alone must fail rather than be invented.
  it("does not invent a domain it cannot know", () => {
    expect(normalizeSpokenEmail("info שטרודל mycompany")).toBeNull();
  });

  // The safety property the whole file rests on: Hebrew cannot appear in an address, so anything
  // left in Hebrew is a word this could not decode — and guessing past it sends mail to a stranger.
  it("refuses rather than guessing when part of it stays in Hebrew", () => {
    expect(normalizeSpokenEmail("ישעיה שטרודל ג'ימייל נקודה קום")).toBeNull();
    expect(normalizeSpokenEmail("dana שטרודל דואר נקודה קום")).toBeNull();
  });

  it("leaves an address that was typed correctly exactly as it is", () => {
    expect(normalizeSpokenEmail("Dana.Levi+bnb@Gmail.com")).toBe("dana.levi+bnb@gmail.com");
    expect(normalizeSpokenEmail("  info@salon.co.il  ")).toBe("info@salon.co.il");
  });

  // "את" is a common Hebrew word and a verb particle. Treating it as @ would corrupt any address
  // whose dictation happens to contain it, which is why only שטרודל is accepted.
  it("does not treat the ordinary word את as an at-sign", () => {
    expect(normalizeSpokenEmail("את השירות")).toBeNull();
  });

  it("drops the full stop that ends the sentence rather than the domain", () => {
    expect(normalizeSpokenEmail("dana שטרודל gmail נקודה com.")).toBe("dana@gmail.com");
  });

  it("survives a doubled separator, which dictation produces constantly", () => {
    expect(normalizeSpokenEmail("dana שטרודל gmail נקודה .com")).toBe("dana@gmail.com");
  });

  it("returns null for nothing at all", () => {
    expect(normalizeSpokenEmail("")).toBeNull();
    expect(normalizeSpokenEmail("   ")).toBeNull();
    expect(normalizeSpokenEmail("שטרודל")).toBeNull();
  });

  it("never returns something that is not an address", () => {
    for (const input of ["hello", "@@@", "a@b", "a@@b.com", "שלום מה קורה"]) {
      const out = normalizeSpokenEmail(input);
      if (out !== null) expect(out).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    }
  });
});
