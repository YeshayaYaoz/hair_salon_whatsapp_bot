import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({ prisma: {} }));

const { chooseTier } = await import("./claudeBot.js");

/**
 * The cheap tier is chosen by a whitelist of short pleasantries, and "כן" and "לא" are on it.
 * They stop being pleasantries the moment the bot has just asked something — "לבטל את התור של
 * יום שלישי?" — because then the answer decides whether an appointment is deleted. A reply to a
 * question goes to the model that asked it, whatever its length.
 */
describe("chooseTier", () => {
  it("sends a greeting out of the blue to the cheap tier", () => {
    expect(chooseTier("היי", false)).toBe("cheap");
    expect(chooseTier("תודה רבה!", false, "בשמחה, נתראה ביום שלישי.")).toBe("cheap");
  });

  it("sends 'כן' to the smart tier when the bot's last turn was a question", () => {
    expect(chooseTier("כן", false, "לבטל את התור של יום שלישי ב-10:00?")).toBe("smart");
    expect(chooseTier("לא", false, "להעביר את התור למחר?")).toBe("smart");
  });

  it("still lets 'כן' be cheap when nothing was asked", () => {
    expect(chooseTier("כן", false, "התור נקבע ליום שלישי ב-10:00.")).toBe("cheap");
    expect(chooseTier("כן", false)).toBe("cheap");
  });

  it("recognises the Arabic question mark too", () => {
    expect(chooseTier("ok", false, "هل أحجز لك الموعد؟")).toBe("smart");
  });

  it("always escalates after a tool error, regardless of the message", () => {
    expect(chooseTier("היי", true)).toBe("smart");
  });

  it("sends anything longer than a pleasantry to the smart tier", () => {
    expect(chooseTier("אפשר תור למחר בבוקר לתספורת?", false)).toBe("smart");
  });
});
