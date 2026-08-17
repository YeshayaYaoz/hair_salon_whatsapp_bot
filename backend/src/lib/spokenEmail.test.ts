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

describe("digits dictated as Hebrew words", () => {
  // The live call this came from: Y28112000 spoken as twenty-eight, one, one, two thousand.
  it("reads the address the caller actually dictated", () => {
    expect(normalizeSpokenEmail("Y עשרים ושמונה אחת אחת אלפיים שטרודל ג'ימייל נקודה קום")).toBe(
      "y28112000@gmail.com"
    );
  });

  it("knows the standalone number words", () => {
    expect(normalizeSpokenEmail("a אלפיים שטרודל gmail")).toBe("a2000@gmail.com");
    expect(normalizeSpokenEmail("a חמישים שטרודל gmail")).toBe("a50@gmail.com");
    expect(normalizeSpokenEmail("a מאה שטרודל gmail")).toBe("a100@gmail.com");
    expect(normalizeSpokenEmail("a מאתיים שטרודל gmail")).toBe("a200@gmail.com");
  });

  // "עשרים ושמונה" is one number; "אחת אחת" is two dictated digits. The ו' is what separates the
  // cases, and merging bare neighbours would turn a real address into a different one.
  it("joins with a vav and never without one", () => {
    expect(normalizeSpokenEmail("a עשרים ושמונה שטרודל gmail")).toBe("a28@gmail.com");
    expect(normalizeSpokenEmail("a אחת אחת שטרודל gmail")).toBe("a11@gmail.com");
    expect(normalizeSpokenEmail("a שתיים שלוש שטרודל gmail")).toBe("a23@gmail.com");
  });

  it("takes both genders of a digit, since dictation uses whichever comes out", () => {
    expect(normalizeSpokenEmail("a שתיים שטרודל gmail")).toBe("a2@gmail.com");
    expect(normalizeSpokenEmail("a שניים שטרודל gmail")).toBe("a2@gmail.com");
  });

  it("reads the composed teen as one number", () => {
    expect(normalizeSpokenEmail("a שתים עשרה שטרודל gmail")).toBe("a12@gmail.com");
  });

  it("multiplies the hundreds form", () => {
    expect(normalizeSpokenEmail("a חמש מאות שטרודל gmail")).toBe("a500@gmail.com");
  });

  // A number word inside an unrelated Hebrew sentence must not leak digits into a rejection.
  it("still refuses a sentence that merely contains number words", () => {
    expect(normalizeSpokenEmail("יש לי שתיים שאלות")).toBeNull();
  });
});
