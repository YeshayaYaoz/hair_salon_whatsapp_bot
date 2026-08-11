import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("../lib/prisma.js", () => ({ prisma: { systemSetting: { findMany: vi.fn(async () => []) } } }));
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
