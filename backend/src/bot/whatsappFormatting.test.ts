import { describe, it, expect, vi } from "vitest";

// claudeBot pulls in prisma and the provider SDKs through its module graph; the formatter under
// test is pure, so stub the heavy dependencies rather than standing them up.
vi.mock("../lib/prisma.js", () => ({ prisma: {} }));

const { toWhatsAppFormatting } = await import("./claudeBot.js");

describe("toWhatsAppFormatting", () => {
  // The reported bug: a price list reached customers as *"צימר תאנה"* with literal asterisks,
  // because WhatsApp bolds with one asterisk and the model emitted Markdown's two.
  it("collapses Markdown bold to WhatsApp's single-asterisk bold", () => {
    expect(toWhatsAppFormatting('**"צימר תאנה"** – 1000₪')).toBe('*"צימר תאנה"* – 1000₪');
    expect(toWhatsAppFormatting("__bold__")).toBe("*bold*");
  });

  it("handles several bolded items across lines independently", () => {
    expect(toWhatsAppFormatting("**תאנה** – 1000\n**חיטה** – 800")).toBe("*תאנה* – 1000\n*חיטה* – 800");
  });

  it("converts Markdown headings to bold, since WhatsApp has no heading markup", () => {
    expect(toWhatsAppFormatting("## המחירים שלנו")).toBe("*המחירים שלנו*");
  });

  it("leaves text that is already valid WhatsApp markup untouched", () => {
    expect(toWhatsAppFormatting("*כבר מודגש* ו-_נטוי_")).toBe("*כבר מודגש* ו-_נטוי_");
  });

  it("leaves plain text and lone asterisks alone", () => {
    expect(toWhatsAppFormatting("מחיר 5 * 2 = 10")).toBe("מחיר 5 * 2 = 10");
    expect(toWhatsAppFormatting("שלום, מה נשמע?")).toBe("שלום, מה נשמע?");
  });
});
