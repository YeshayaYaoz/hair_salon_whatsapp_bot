import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("../lib/prisma.js", () => ({
  prisma: { systemSetting: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) } },
}));
vi.mock("../lib/crypto.js", () => ({ encryptSecret: (v: string) => `enc:${v}`, decryptSecret: (v: string) => v.replace(/^enc:/, "") }));
vi.mock("../api/businessRoutes.js", () => ({ requireSuperAdmin: (_req: unknown, _res: unknown, next: () => void) => next() }));

/**
 * The browser's landing after a paid billing checkout. PayPlus POSTs to refURL_success; the
 * trampoline must turn any method into a clean GET (303) and must never become an open redirect —
 * a redirect-after-payment URL that forwards anywhere is a phishing primitive.
 */
describe("POST /webhook/billing/payplus/return/redirect", () => {
  let app: express.Express;
  beforeEach(async () => {
    process.env.APP_URL = "https://app.example.com";
    const { payplusBillingWebhookRouter } = await import("./payplusBillingRoutes.js");
    app = express();
    app.use(express.json());
    app.use("/webhook/billing/payplus", payplusBillingWebhookRouter);
  });

  it("303s a POST to the requested same-origin destination", async () => {
    const to = encodeURIComponent("https://app.example.com/dashboard/billing?x=1");
    const res = await request(app).post(`/webhook/billing/payplus/return/redirect?to=${to}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("https://app.example.com/dashboard/billing?x=1");
  });

  it("refuses to forward off-origin and falls back to the billing page", async () => {
    const to = encodeURIComponent("https://evil.example.net/phish");
    const res = await request(app).get(`/webhook/billing/payplus/return/redirect?to=${to}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("https://app.example.com/dashboard/billing");
  });

  it("survives a missing or garbled destination", async () => {
    const res = await request(app).post("/webhook/billing/payplus/return/redirect?to=not-a-url");
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("https://app.example.com/dashboard/billing");
  });
});

/**
 * The ₪1 health payment parks its token as the operator's test card — the cheapest live test of
 * the renewal charge. A health callback must never touch a business row.
 */
describe("billing-health callback", () => {
  let app: express.Express;
  let upsert: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    process.env.APP_URL = "https://app.example.com";
    process.env.PAYPLUS_BILLING_WEBHOOK_SECRET = "hook-secret";
    process.env.PAYPLUS_API_KEY = "k"; process.env.PAYPLUS_SECRET_KEY = "s"; process.env.PAYPLUS_PAGE_UID = "pg";
    const prismaModule = await import("../lib/prisma.js");
    upsert = (prismaModule.prisma as never as { systemSetting: { upsert: ReturnType<typeof vi.fn> } }).systemSetting.upsert;
    upsert.mockClear();
    // Token/List answers with the card the checkout stored.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: { status: "success" }, data: [{ token: "tok-health", customer_uid: "cust-h" }] }),
    })));
    const { payplusBillingWebhookRouter } = await import("./payplusBillingRoutes.js");
    app = express();
    app.use(express.json());
    app.use("/webhook/billing/payplus", payplusBillingWebhookRouter);
  });

  it("recovers the token via Token/List and parks it, touching no business", async () => {
    await request(app).post("/webhook/billing/payplus/hook-secret").send({
      transaction_type: "Charge",
      transaction: { status_code: "000", amount: 1, more_info: "billing-health" },
      data: { customer_uid: "cust-h", terminal_uid: "term-h", cashier_uid: "cash-h" },
    });
    await new Promise((r) => setTimeout(r, 50)); // handler continues after the 200
    const keys = upsert.mock.calls.map((c) => (c[0] as { where: { key: string } }).where.key);
    expect(keys).toContain("payplus_health_token");
    const healthCall = upsert.mock.calls.find((c) => (c[0] as { where: { key: string } }).where.key === "payplus_health_token");
    expect((healthCall![0] as { create: { value: string } }).create.value).toBe("enc:tok-health");
    vi.unstubAllGlobals();
  });
});
