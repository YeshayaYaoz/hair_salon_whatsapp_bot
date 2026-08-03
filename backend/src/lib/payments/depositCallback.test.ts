import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { depositCallbackUrl } from "./index.js";
import { payplusProvider } from "./payplus.js";

/**
 * The limit this removes: PayPlus (and every provider here) has ONE account-level callback field,
 * while our webhook URL carries the businessId in its path. So one merchant account could only
 * route deposits to one business in Tori — a second business sharing the account would have its
 * customers pay and never get a confirmed booking, with nothing in any log.
 */
describe("depositCallbackUrl", () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.PUBLIC_BACKEND_URL = "https://api.example.com";
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it("carries the business id, which is what makes a shared merchant account work", () => {
    const a = depositCallbackUrl("biz_a", "payplus", "secret1");
    const b = depositCallbackUrl("biz_b", "payplus", "secret2");
    expect(a).toBe("https://api.example.com/webhook/payments/payplus/biz_a/secret1");
    expect(a).not.toBe(b);
  });

  it("accepts a bare domain — Railway shows service domains without a scheme", () => {
    process.env.PUBLIC_BACKEND_URL = "api.example.com";
    expect(depositCallbackUrl("biz", "payplus", "s")).toBe("https://api.example.com/webhook/payments/payplus/biz/s");
  });

  it("strips a trailing slash rather than producing a double one", () => {
    process.env.PUBLIC_BACKEND_URL = "https://api.example.com/";
    expect(depositCallbackUrl("biz", "payplus", "s")).toContain("com/webhook/");
  });

  it("returns null with no secret — no callback beats one that will be rejected", () => {
    expect(depositCallbackUrl("biz", "payplus", null)).toBeNull();
  });

  it("returns null when no public base is configured", () => {
    delete process.env.PUBLIC_BACKEND_URL;
    delete process.env.APP_URL;
    expect(depositCallbackUrl("biz", "payplus", "s")).toBeNull();
  });
});

describe("payplus createPaymentLink", () => {
  const original = { ...process.env };
  let body: Record<string, unknown>;

  beforeEach(() => {
    process.env.PAYPLUS_ENV = "sandbox";
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return {
        ok: true,
        json: async () => ({ data: { payment_page_link: "https://pay/x", page_request_uid: "uid1" } }),
      };
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    process.env = { ...original };
  });

  const creds = { apiKey: "k", apiSecret: "s", pageUid: "page1" };
  const base = { amountIls: 100, description: "מקדמה", referenceId: "appt1" };

  it("sends refURL_callback so the account-level field is not what decides routing", async () => {
    await payplusProvider.createPaymentLink(creds, { ...base, callbackUrl: "https://api.example.com/webhook/payments/payplus/biz/s" });
    expect(body.refURL_callback).toBe("https://api.example.com/webhook/payments/payplus/biz/s");
  });

  it("omits the field entirely when there is no callback URL, rather than sending an empty one", async () => {
    await payplusProvider.createPaymentLink(creds, base);
    expect(body).not.toHaveProperty("refURL_callback");
  });

  it("still sends the appointment id as more_info — that is what matches the webhook to a hold", async () => {
    await payplusProvider.createPaymentLink(creds, base);
    expect(body.more_info).toBe("appt1");
  });
});
