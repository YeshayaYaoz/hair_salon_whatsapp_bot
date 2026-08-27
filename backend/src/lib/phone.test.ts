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

  /**
   * The country used to be guessed from the digits, which got two entries wrong. The dropdown
   * beside the field now says which country it is, and these pin what that changed.
   */
  describe("with a country chosen in the dashboard", () => {
    it("qualifies a bare national number that would otherwise be stored undeliverable", () => {
      // No trunk zero and no country code: this used to pass validation on length alone and save
      // as "555077941", a number that can never be delivered to.
      expect(normalizeOwnerPhone("555077941")).toBe("972555077941");
      expect(normalizeOwnerPhone("7700900123", "44")).toBe("447700900123");
    });

    it("stops forcing 972 onto a foreign number written with its own trunk zero", () => {
      // "07700 900123" is how a UK owner writes their own line; the old rule read that 0 as Israeli.
      expect(normalizeOwnerPhone("07700 900123", "44")).toBe("447700900123");
      expect(normalizeOwnerPhone("0501234567", "972")).toBe("972501234567");
    });

    it("does not double the country code on a number that already carries it", () => {
      expect(normalizeOwnerPhone("972501234567", "972")).toBe("972501234567");
      expect(normalizeOwnerPhone("447700900123", "44")).toBe("447700900123");
    });

    it("lets an explicit + override the dropdown", () => {
      // Someone who typed the country themselves meant it, whatever the select happens to show.
      expect(normalizeOwnerPhone("+44 7700 900123", "972")).toBe("447700900123");
    });

    it("still defaults to Israel when no country is passed", () => {
      expect(normalizeOwnerPhone("0501234567")).toBe("972501234567");
    });
  });

  it("accepts a foreign number rather than assuming everyone is in Israel", () => {
    // An owner may legitimately take alerts on a number abroad; rejecting it would be worse than
    // accepting an unusual one, since the send itself is what proves reachability either way.
    expect(normalizeOwnerPhone("+44 7700 900123")).toBe("447700900123");
  });
});

describe("manually added customers", () => {
  // The property the manual-add route depends on: a customer typed into the dashboard has to end
  // up stored in the exact string WhatsApp reports as `message.from` on an inbound message, or the
  // webhook's lookup by (businessId, phone) misses and the same person exists twice — once dead.
  const WHATSAPP_REPORTS = "972501234567";

  it.each([
    ["0501234567", "972"],
    ["050-123-4567", "972"],
    ["050 123 4567", "972"],
    ["+972501234567", "972"],
    ["972501234567", "972"],
    ["50-123-4567", "972"],
  ])("stores %s as the form WhatsApp reports", (typed, dial) => {
    expect(normalizeOwnerPhone(typed, dial)).toBe(WHATSAPP_REPORTS);
  });

  it("refuses a number that is too short to be real, rather than storing an unreachable row", () => {
    expect(normalizeOwnerPhone("050123", "972")).toBeNull();
  });
});
