import { describe, it, expect } from "vitest";
import { extractCode } from "./cartesia-code.js";

/**
 * Pulling six digits out of a call record is harder than it looks, and getting it wrong is
 * expensive: Meta rejects the wrong code, and a rejection is indistinguishable from a
 * mis-transcribed one — so the first instinct is to go and investigate the transcription, which is
 * fine, while the real cause is that a slice of the phone number was submitted.
 *
 * That is not hypothetical. "+972559661420" contains several six-digit runs, and the first live
 * verification attempt submitted one of them.
 */

const KNOWN = ["+972559661420", "+972533391353", "ac_PA_AwktZLPEECiw"];

describe("extractCode", () => {
  it("finds nothing in a record that only holds phone numbers", () => {
    const payload = '{"to":"+972559661420","from":"+972533391353","id":"ac_PA_AwktZLPEECiw"}';
    expect(extractCode(payload, KNOWN)).toBeNull();
  });

  it("reads a code spoken digit by digit, which is how Meta's robot reads it", () => {
    expect(extractCode('{"to":"+972559661420"} your code is 4 8 2 9 1 7', KNOWN)).toBe("482917");
  });

  it("reads a code the transcriber joined into one number", () => {
    expect(extractCode('{"to":"+972559661420","summary":"code 482917"}', KNOWN)).toBe("482917");
  });

  it("reads digits the Hebrew STT rendered as words", () => {
    // The agent's speech recognition is configured for Hebrew and will sometimes transcribe spoken
    // English digits into Hebrew.
    expect(extractCode("ארבע שמונה שתיים תשע אחת שבע", KNOWN)).toBe("482917");
  });

  it("does not splice two unrelated numbers into a code", () => {
    // "123" and "456" are three digits each and nothing was spoken as six. Concatenating every
    // digit in a payload would invent one.
    expect(extractCode('{"a":"123","b":"456"}', KNOWN)).toBeNull();
  });

  it("still works with no exclusions given", () => {
    expect(extractCode("code: 482917")).toBe("482917");
  });
});
