import { describe, it, expect, vi } from "vitest";

// The module pulls in prisma and the WhatsApp client at import time; neither is touched by the two
// pure functions under test.
vi.mock("./prisma.js", () => ({ prisma: {} }));
vi.mock("../webhook/whatsappClient.js", () => ({
  sendWhatsAppMessage: vi.fn(), sendWhatsAppTemplate: vi.fn(),
  WhatsAppSendError: class extends Error {}, RE_ENGAGEMENT_ERROR_CODE: 131047,
}));
vi.mock("./ownerNotify.js", () => ({ notifyOwner: vi.fn() }));
vi.mock("./wallet.js", () => ({ meterOutboundMessage: vi.fn() }));
vi.mock("./crypto.js", () => ({ decryptSecret: (s: string) => s }));

const { digestFrequencyOf, isDigestDay } = await import("./scheduledMessages.js");

describe("digestFrequencyOf", () => {
  it("reads the owner's choice", () => {
    for (const f of ["daily", "weekly", "monthly", "off"]) {
      expect(digestFrequencyOf({ digestEnabled: true, digestFrequency: f })).toBe(f);
    }
  });

  it("stays off when the older switch is off, whatever the frequency says", () => {
    // The two fields can disagree — business templates set digestEnabled, this control sets the
    // frequency — and an owner who turned the digest off must not be re-subscribed by a default.
    expect(digestFrequencyOf({ digestEnabled: false, digestFrequency: "daily" })).toBe("off");
    expect(digestFrequencyOf({ digestEnabled: false, digestFrequency: "weekly" })).toBe("off");
  });

  it("falls back to daily for a value it does not recognise", () => {
    // Rows written before the column existed, or by a future version. Daily is the prior behaviour.
    expect(digestFrequencyOf({ digestEnabled: true, digestFrequency: "" })).toBe("daily");
    expect(digestFrequencyOf({ digestEnabled: true, digestFrequency: "fortnightly" })).toBe("daily");
  });
});

describe("isDigestDay", () => {
  it("sends every day when daily", () => {
    for (let dow = 0; dow < 7; dow++) expect(isDigestDay("daily", dow, 14)).toBe(true);
  });

  it("sends weekly on Sunday only — the start of the Israeli work week", () => {
    expect(isDigestDay("weekly", 0, 14)).toBe(true);
    for (let dow = 1; dow < 7; dow++) expect(isDigestDay("weekly", dow, 14)).toBe(false);
  });

  it("sends monthly on the 1st only", () => {
    expect(isDigestDay("monthly", 3, 1)).toBe(true);
    for (const day of [2, 15, 28, 31]) expect(isDigestDay("monthly", 3, day)).toBe(false);
  });

  it("never sends when off", () => {
    // Belt and braces: runDigestJob returns before this, but a future caller might not.
    for (let dow = 0; dow < 7; dow++) expect(isDigestDay("off", dow, 1)).toBe(false);
  });
});
