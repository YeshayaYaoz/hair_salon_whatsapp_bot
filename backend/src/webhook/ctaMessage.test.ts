import { describe, it, expect, vi, beforeEach } from "vitest";

const sent: any[] = [];
const mockFetch = vi.fn(async (_url: string, init: any) => {
  sent.push(JSON.parse(init.body));
  return { ok: true, json: async () => ({}) } as any;
});
vi.stubGlobal("fetch", mockFetch);

const { sendWhatsAppCtaUrl, sendWhatsAppButtons } = await import("./whatsappClient.js");

const base = { phoneNumberId: "pid", accessToken: "tok", to: "972500000000" };

beforeEach(() => sent.splice(0));

/**
 * WhatsApp enforces these limits by rejecting the send, not by truncating — and this is the very
 * first message a customer ever gets, so a rejection is silence at the worst possible moment.
 */
describe("sendWhatsAppCtaUrl", () => {
  it("builds a cta_url interactive message with the button and link", async () => {
    await sendWhatsAppCtaUrl({ ...base, body: "שלום!", buttonText: "לאתר שלנו", url: "https://zimmermeron.co.il" });
    expect(sent[0].type).toBe("interactive");
    expect(sent[0].interactive.type).toBe("cta_url");
    expect(sent[0].interactive.body.text).toBe("שלום!");
    expect(sent[0].interactive.action.parameters).toEqual({
      display_text: "לאתר שלנו",
      url: "https://zimmermeron.co.il",
    });
  });

  it("trims a button label past WhatsApp's 20-character limit", async () => {
    await sendWhatsAppCtaUrl({ ...base, body: "x", buttonText: "כפתור עם שם ארוך מדי שלא יתקבל", url: "https://x.co" });
    expect(sent[0].interactive.action.parameters.display_text.length).toBe(20);
  });

  it("trims a body past the 1024-character limit", async () => {
    await sendWhatsAppCtaUrl({ ...base, body: "א".repeat(2000), buttonText: "לחץ", url: "https://x.co" });
    expect(sent[0].interactive.body.text.length).toBe(1024);
  });

  it("omits the footer entirely when there isn't one", async () => {
    await sendWhatsAppCtaUrl({ ...base, body: "x", buttonText: "לחץ", url: "https://x.co" });
    expect(sent[0].interactive.footer).toBeUndefined();
  });
});

describe("sendWhatsAppButtons", () => {
  it("builds a button interactive message with one reply per option", async () => {
    await sendWhatsAppButtons({ ...base, body: "במה אפשר לעזור?", buttons: ["מחירים", "תמונות", "תאריכים"] });
    expect(sent[0].interactive.type).toBe("button");
    expect(sent[0].interactive.action.buttons.map((b: any) => b.reply.title)).toEqual([
      "מחירים",
      "תמונות",
      "תאריכים",
    ]);
    expect(sent[0].interactive.action.buttons[0].type).toBe("reply");
  });

  it("keeps only the first three — WhatsApp rejects a fourth", async () => {
    await sendWhatsAppButtons({ ...base, body: "x", buttons: ["א", "ב", "ג", "ד"] });
    expect(sent[0].interactive.action.buttons).toHaveLength(3);
  });

  it("trims a title past 20 characters", async () => {
    await sendWhatsAppButtons({ ...base, body: "x", buttons: ["כפתור עם כותרת ארוכה מדי בהרבה"] });
    expect(sent[0].interactive.action.buttons[0].reply.title.length).toBe(20);
  });

  it("drops blanks rather than sending an empty button", async () => {
    // The dashboard has three boxes; leaving the middle one empty must not produce a button with
    // no label, which WhatsApp rejects outright.
    await sendWhatsAppButtons({ ...base, body: "x", buttons: ["מחירים", "   ", "תמונות"] });
    expect(sent[0].interactive.action.buttons.map((b: any) => b.reply.title)).toEqual(["מחירים", "תמונות"]);
  });
});
