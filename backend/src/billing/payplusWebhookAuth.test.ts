import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const mockPrisma = {
  business: { update: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  // The webhook persists a keys-only diagnostic of every callback for the admin health card.
  systemSetting: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
};
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
    mockPrisma.business.findUnique.mockResolvedValue({ id: "biz1", checkoutPlan: "premium", checkoutCycle: "annual" });
    const { payplusBillingWebhookRouter } = await import("./payplusBillingRoutes.js");
    app = express();
    app.use(express.json());
    app.use("/webhook/billing/payplus", payplusBillingWebhookRouter);
  });

  const validPayload = {
    // A short checkout reference, not a businessId — PayPlus caps more_info at 19 characters.
    data: { status_code: "000", more_info: "a1b2c3d4e5f60718", token_uid: "tok_123" },
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

  it("clears the pending checkout so a replayed callback can't re-activate", async () => {
    await request(app).post("/webhook/billing/payplus/correct-horse-battery-staple").send(validPayload);
    await new Promise((r) => setImmediate(r));
    expect(mockPrisma.business.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ checkoutRef: null, checkoutPlan: null }) })
    );
  });

  it("ignores a callback whose reference has no pending checkout", async () => {
    mockPrisma.business.findUnique.mockResolvedValue(null);
    await request(app).post("/webhook/billing/payplus/correct-horse-battery-staple").send(validPayload);
    await new Promise((r) => setImmediate(r));
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

  /**
   * A browser-openable version of the same check, so confirming the callback URL does not require
   * hand-crafting a POST. It must reveal nothing a POST to the same path does not already reveal,
   * and must never touch the database.
   */
  it("confirms a matching secret over GET, without writing anything", async () => {
    const res = await request(app).get("/webhook/billing/payplus/correct-horse-battery-staple");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockPrisma.business.update).not.toHaveBeenCalled();
    expect(mockPrisma.business.findUnique).not.toHaveBeenCalled();
  });

  it("404s a wrong secret over GET, same as the real endpoint", async () => {
    const res = await request(app).get("/webhook/billing/payplus/wrong-secret-entirely");
    expect(res.status).toBe(404);
  });

  it("does not report ok over GET when no secret is configured at all", async () => {
    delete process.env.PAYPLUS_BILLING_WEBHOOK_SECRET;
    const res = await request(app).get("/webhook/billing/payplus/anything");
    expect(res.status).toBe(404);
  });
});
