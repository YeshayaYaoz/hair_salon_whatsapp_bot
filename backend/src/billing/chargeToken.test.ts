import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// payplusSubscription.js pulls in lib/prisma, which builds a real PrismaClient at import time and
// throws without DATABASE_URL. Nothing here touches the database, so the suite would otherwise
// pass or fail on whether the machine running it happens to have a .env — every other test file
// mocks prisma for the same reason.
const mockSystemSetting = { findMany: vi.fn(async () => [] as Array<{ key: string; value: string }>) };
vi.mock("../lib/prisma.js", () => ({ prisma: { systemSetting: mockSystemSetting } }));

const { chargeSubscriptionToken, PayPlusTerminalNotConfiguredError, probeGenerateLink, fetchTokenForCustomer } = await import("./payplusSubscription.js");

/**
 * Pins the HTTP contract of the token charge — endpoint path and required fields.
 *
 * Every other billing test mocks chargeSubscriptionToken itself, which is how a request to
 * `Transactions/ChargeByToken` — an endpoint that does not exist on PayPlus's API — survived
 * unnoticed: the hosted checkout page worked, so first payments arrived, and only renewals
 * (nightly job, annual switch, prorated upgrades, token top-ups) would have failed, after the
 * customer was already active. This test talks to the real function and asserts what goes on
 * the wire, so a drive-by rename of the path or a dropped required field fails here first.
 */

const ENV = {
  PAYPLUS_API_KEY: "key",
  PAYPLUS_SECRET_KEY: "secret",
  PAYPLUS_PAGE_UID: "page-1",
  PAYPLUS_TERMINAL_UID: "term-1",
  PAYPLUS_CASHIER_UID: "cash-1",
};

const fetchMock = vi.fn();

beforeEach(() => {
  Object.assign(process.env, ENV);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(ENV)) delete process.env[k];
});

function okResponse(data: unknown) {
  return { ok: true, json: async () => ({ results: { status: "success" }, data }) };
}

describe("chargeSubscriptionToken", () => {
  it("POSTs Transactions/Charge (J4) — ChargeByToken does not exist on PayPlus", async () => {
    fetchMock.mockResolvedValue(okResponse({ transaction_uid: "tr-9" }));
    const result = await chargeSubscriptionToken("tok-1", 149, "תורי — חיוב חודשי");

    expect(result).toEqual({ success: true, transactionId: "tr-9" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/Transactions/Charge");
    expect(url).not.toContain("ChargeByToken");

    const body = JSON.parse((init as RequestInit).body as string);
    // The J4 required set, per docs.payplus.co.il — dropping any of these is a rejected charge.
    expect(body).toMatchObject({
      terminal_uid: "term-1",
      cashier_uid: "cash-1",
      amount: 149,
      currency_code: "ILS",
      use_token: true,
      token: "tok-1",
    });
    // J4 has no plain more_info; the description must travel in more_info_1 or it is lost.
    expect(body.more_info_1).toBe("תורי — חיוב חודשי");
  });

  it("refuses to guess when the terminal is not configured, naming the variables", async () => {
    delete process.env.PAYPLUS_TERMINAL_UID;
    await expect(chargeSubscriptionToken("tok", 149, "x")).rejects.toThrow(PayPlusTerminalNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the terminal/cashier captured from a checkout callback", async () => {
    // One paid checkout configures renewals by itself: the webhook stores what the callback
    // carried, and the charge uses it when the env vars were never set.
    delete process.env.PAYPLUS_TERMINAL_UID;
    delete process.env.PAYPLUS_CASHIER_UID;
    mockSystemSetting.findMany.mockResolvedValueOnce([
      { key: "payplus_terminal_uid", value: "term-captured" },
      { key: "payplus_cashier_uid", value: "cash-captured" },
    ]);
    fetchMock.mockResolvedValue(okResponse({ transaction_uid: "tr-1" }));
    const result = await chargeSubscriptionToken("tok", 149, "x");
    expect(result.success).toBe(true);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.terminal_uid).toBe("term-captured");
    expect(body.cashier_uid).toBe("cash-captured");
  });

  it("surfaces PayPlus's own rejection reason instead of a generic failure", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ results: { status: "error", description: "card declined" } }),
    });
    const result = await chargeSubscriptionToken("tok", 149, "x");
    expect(result).toEqual({ success: false, error: "card declined" });
  });

  it("reads the transaction id from either response shape PayPlus uses", async () => {
    fetchMock.mockResolvedValue(okResponse({ transaction: { uid: "tr-nested" } }));
    const result = await chargeSubscriptionToken("tok", 149, "x");
    expect(result.transactionId).toBe("tr-nested");
  });
});

describe("probeGenerateLink", () => {
  it("wires the same callback URL a real checkout gets — the ₪1 test must exercise the full path", async () => {
    // The first live ₪1 was paid without this: money arrived, no callback was sent, and the
    // terminal/cashier auto-capture silently did not happen. A test page that exercises less
    // than the real flow reports health it did not earn.
    process.env.PUBLIC_BACKEND_URL = "https://api.example.com";
    process.env.PAYPLUS_BILLING_WEBHOOK_SECRET = "hook-secret";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ results: { status: "success" }, data: { payment_page_link: "https://pay/1" } }),
    });
    const r = await probeGenerateLink();
    expect(r).toEqual({ ok: true, url: "https://pay/1" });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.refURL_callback).toBe("https://api.example.com/webhook/billing/payplus/hook-secret");
    delete process.env.PUBLIC_BACKEND_URL;
    delete process.env.PAYPLUS_BILLING_WEBHOOK_SECRET;
  });
});

describe("checkout return trampoline", () => {
  it("routes refURL_success through the backend, which answers POST with a 303", async () => {
    // PayPlus sends the browser back with a POST; a Next.js page answers that with 405 — which is
    // what a customer who had just paid (with the PayPlus email to prove it) used to see first.
    process.env.PUBLIC_BACKEND_URL = "https://api.example.com";
    process.env.PAYPLUS_BILLING_WEBHOOK_SECRET = "hook-secret";
    const { createWalletTopupLink } = await import("./payplusSubscription.js");
    const prismaModule = await import("../lib/prisma.js");
    (prismaModule.prisma as Record<string, unknown>).business = {
      update: async () => ({ name: "עסק", email: "x@y.z" }),
    };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ results: { status: "success" }, data: { payment_page_link: "https://pay/1" } }),
    });
    await createWalletTopupLink("biz1", 20, "https://app.example.com/dashboard/billing");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.refURL_success).toBe(
      "https://api.example.com/webhook/billing/payplus/return/redirect?to=" +
        encodeURIComponent("https://app.example.com/dashboard/billing")
    );
    delete process.env.PUBLIC_BACKEND_URL;
    delete process.env.PAYPLUS_BILLING_WEBHOOK_SECRET;
  });
});

describe("fetchTokenForCustomer", () => {
  it("retrieves the token Token/List holds for the callback's customer — the callback itself never carries one", async () => {
    // Verified with a real paid checkout: wallet credited, callback parsed, and no token field
    // anywhere in the payload or in any of PayPlus's documented callback/redirect/IPN schemas.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: { status: "success" },
        data: [
          { token: "tok-old", customer_uid: "cust-1" },
          { token: "tok-newest", customer_uid: "cust-1" },
        ],
      }),
    });
    const token = await fetchTokenForCustomer("term-1", "cust-1");
    expect(token).toBe("tok-newest");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/Token/List");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ terminal_uid: "term-1", customer_uid: "cust-1" });
  });

  it("returns undefined when the account has no tokens — tokenization likely not enabled", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ results: { status: "success" }, data: [] }) });
    expect(await fetchTokenForCustomer("term-1", "cust-1")).toBeUndefined();
  });
});
