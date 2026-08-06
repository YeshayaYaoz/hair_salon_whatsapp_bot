import { describe, it, expect } from "vitest";
import { normalizePhone, normalizeOwnerPhone } from "./phone.js";

describe("normalizePhone", () => {
  it("treats the same line written every way as one number", () => {
    // The bug this was written for: Cartesia dials "+972555077941" while the owner types
    // "055-507-7941". Stripping punctuation alone leaves two unequal strings, the call resolves to
    // no business, and the agent answers a real caller with no idea whose salon it is.
    const forms = ["+972555077941", "972555077941", "055-507-7941", "0555077941", "055 507 7941"];
    const normalized = new Set(forms.map(normalizePhone));
    expect(normalized.size).toBe(1);
    expect([...normalized][0]).toBe("972555077941");
  });
});

describe("normalizeOwnerPhone", () => {
  it("accepts the ways an owner actually writes their own number", () => {
    expect(normalizeOwnerPhone("0501234567")).toBe("972501234567");
    expect(normalizeOwnerPhone("050-123-4567")).toBe("972501234567");
    expect(normalizeOwnerPhone(" +972 50 123 4567 ")).toBe("972501234567");
    expect(normalizeOwnerPhone("03-1234567")).toBe("97231234567"); // landline
  });

  it("rejects what is definitely not a phone number", () => {
    // These are the entries worth catching before Meta returns an opaque failure hours later, at
    // the moment a customer has just been promised a callback.
    expect(normalizeOwnerPhone("")).toBeNull();
    expect(normalizeOwnerPhone("050")).toBeNull();
    expect(normalizeOwnerPhone("תתקשרו אליי")).toBeNull();
    expect(normalizeOwnerPhone("₪120")).toBeNull();
    expect(normalizeOwnerPhone("05012345")).toBeNull(); // truncated
  });

  it("accepts a foreign number rather than assuming everyone is in Israel", () => {
    // An owner may legitimately take alerts on a number abroad; rejecting it would be worse than
    // accepting an unusual one, since the send itself is what proves reachability either way.
    expect(normalizeOwnerPhone("+44 7700 900123")).toBe("447700900123");
  });
});
