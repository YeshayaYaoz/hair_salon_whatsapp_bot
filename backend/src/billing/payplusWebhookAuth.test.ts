import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const mockPrisma = { business: { update: vi.fn(), findUniqueOrThrow: vi.fn() } };
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/crypto.js", () => ({ encryptSecret: (v: string) => v, decryptSecret: (v: string) => v }));
vi.mock("../lib/errorMonitoring.js", () => ({ captureError: vi.fn() }));

/**
 * The hole this guards: the endpoint took a businessId straight out of the request body and
 * activated a paid subscription for it, with nothing to prove the call came from PayPlus. Anyone
 * who found the URL could put any businessId in more_info and be on Premium annual for free.
 */
describe("subscription webhook authentication", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.PAYPLUS_BILLING_WEBHOOK_SECRET = "correct-horse-battery-staple";
    const { payplusBillingWebhookRouter } = await import("./payplusBillingRoutes.js");
    app = express();
    app.use(express.json());
    app.use("/webhook/billing/payplus", payplusBillingWebhookRouter);
  });

  const validPayload = {
    data: { status_code: "000", more_info: "biz1:premium:annual", token_uid: "tok_123" },
  };

  it("activates the subscription when the secret matches", async () => {
    const res = await request(app).post("/webhook/billing/payplus/correct-horse-battery-staple").send(validPayload);
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r)); // the handler responds before doing the DB write
    expect(mockPrisma.business.update).toHaveBeenCalled();
  });

  it("rejects a wrong secret and writes nothing", async () => {
    const res = await request(app).post("/webhook/billing/payplus/wrong-secret-entirely").send(validPayload);
    expect(res.status).toBe(404);
    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });

  it("rejects a secret of a different length without leaking that via timing", async () => {
    const res = await request(app).post("/webhook/billing/payplus/short").send(validPayload);
    expect(res.status).toBe(404);
    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });

  it("rejects everything when the secret isn't configured, rather than defaulting to open", async () => {
    vi.resetModules();
    delete process.env.PAYPLUS_BILLING_WEBHOOK_SECRET;
    const { payplusBillingWebhookRouter } = await import("./payplusBillingRoutes.js");
    const bare = express();
    bare.use(express.json());
    bare.use("/webhook/billing/payplus", payplusBillingWebhookRouter);

    const res = await request(bare).post("/webhook/billing/payplus/anything").send(validPayload);
    expect(res.status).toBe(503);
    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });
});
