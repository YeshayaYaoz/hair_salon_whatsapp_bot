import { describe, it, expect, afterEach, vi } from "vitest";
import { enrichWebsite } from "./enrichment.js";

function mockHtmlResponse(html: string) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => html }));
}

describe("enrichWebsite — email extraction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null for every field, including email, when there is no website", async () => {
    const result = await enrichWebsite(null);
    expect(result.email).toBeNull();
    expect(result.hasOnlineBooking).toBeNull();
  });

  it("returns null email when the fetch fails, without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await enrichWebsite("https://example-salon.co.il");
    expect(result.email).toBeNull();
  });

  it("prefers a mailto: link over a bare address appearing elsewhere on the page", async () => {
    mockHtmlResponse(`
      <html><body>
        <p>Follow us, mentioned once in passing: someoneelse@random.com</p>
        <a href="mailto:info@dana-salon.co.il">Email us</a>
      </body></html>
    `);
    const result = await enrichWebsite("https://dana-salon.co.il");
    expect(result.email).toBe("info@dana-salon.co.il");
  });

  it("strips a subject= query string off a mailto: link", async () => {
    mockHtmlResponse(`<a href="mailto:contact@salon.com?subject=Hello%20there">Email</a>`);
    const result = await enrichWebsite("https://salon.com");
    expect(result.email).toBe("contact@salon.com");
  });

  it("falls back to a plain-text email when there is no mailto: link", async () => {
    mockHtmlResponse(`<p>Reach us at hello@salon-studio.com any time</p>`);
    const result = await enrichWebsite("https://salon-studio.com");
    expect(result.email).toBe("hello@salon-studio.com");
  });

  it("skips denylisted platform/boilerplate domains and keeps looking", async () => {
    mockHtmlResponse(`
      <script src="https://sentry-next.wixpress.com/error-monitor"></script>
      <!-- tracking pixel: noreply@sentry.io -->
      <p>Contact: owner@real-salon.co.il</p>
    `);
    const result = await enrichWebsite("https://real-salon.co.il");
    expect(result.email).toBe("owner@real-salon.co.il");
  });

  it("rejects an image-filename false positive like logo@2x.png", async () => {
    mockHtmlResponse(`<img src="logo@2x.png" /><p>call us, no email listed</p>`);
    const result = await enrichWebsite("https://no-email-salon.com");
    expect(result.email).toBeNull();
  });

  it("returns null when no email-shaped text appears anywhere on the page", async () => {
    mockHtmlResponse(`<html><body><h1>Welcome to our salon</h1></body></html>`);
    const result = await enrichWebsite("https://plain-salon.com");
    expect(result.email).toBeNull();
  });

  it("lowercases the discovered address", async () => {
    mockHtmlResponse(`<a href="mailto:Info@Salon.CO.IL">Email</a>`);
    const result = await enrichWebsite("https://salon.co.il");
    expect(result.email).toBe("info@salon.co.il");
  });
});
