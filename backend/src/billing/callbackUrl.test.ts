import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * The callback URL PayPlus is told to call has to be one this app answers.
 *
 * It was built by interpolating the secret straight into a path segment, so a secret holding a "/"
 * or a space produced a URL matching no route: PayPlus charged the card, called back into a 404,
 * and the subscription was never activated. The only trace was a startup warning nobody reads
 * during a deploy — this failure costs a paying customer and is invisible from the inside.
 *
 * So the test is a round trip rather than a string check: build the URL the way the checkout does,
 * then POST to it against the real webhook router and require it to be authenticated.
 */

const mockPrisma = {
  business: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
};
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/crypto.js", () => ({ encryptSecret: (v: string) => `enc:${v}`, decryptSecret: (v: string) => v }));
vi.mock("../lib/errorMonitoring.js", () => ({ captureError: vi.fn() }));

const ORIGINAL = { ...process.env };

/** The one line under test, lifted from payplusSubscription's generateLink body. */
function callbackUrl(base: string, secret: string): string {
  return `${base}/webhook/billing/payplus/${encodeURIComponent(secret)}`;
}

describe("the PayPlus callback URL routes back to us", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.PUBLIC_BACKEND_URL = "https://api.example.com";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  async function mount() {
    const { payplusBillingWebhookRouter } = await import("./payplusBillingRoutes.js");
    app = express();
    app.use(express.json());
    app.use("/webhook/billing/payplus", payplusBillingWebhookRouter);
    return app;
  }

  // Each of these is a secret someone could plausibly paste in: a generated base64 token, a
  // passphrase, a value from a password manager. None of them is chosen with URL grammar in mind.
  const awkward = [
    ["a slash", "abc/def" + "x".repeat(20)],
    ["a space", "correct horse battery staple"],
    ["base64 padding", "c2VjcmV0LXZhbHVlLWhlcmU=" + "x".repeat(8)],
    ["a question mark", "why?" + "x".repeat(20)],
    ["a hash", "tori#billing" + "x".repeat(20)],
  ] as const;

  for (const [what, secret] of awkward) {
    it(`survives ${what} in the secret`, async () => {
      process.env.PAYPLUS_BILLING_WEBHOOK_SECRET = secret;
      await mount();

      const url = callbackUrl("https://api.example.com", secret);
      const path = url.replace("https://api.example.com", "");

      const res = await request(app).post(path).send({ status_code: "000", more_info: "biz1:premium" });
      // 200 is the acknowledgement sent the moment the secret compares equal — the route matched
      // and the call was accepted. What the handler then does with the payload is covered
      // elsewhere; what matters here is that PayPlus is not turned away at the door.
      expect(res.status).toBe(200);
    });
  }

  it("still rejects a caller who guesses the wrong secret", async () => {
    // The encoding must not have widened what counts as a match: this endpoint activates paid
    // plans, and the secret is the only thing in front of it.
    process.env.PAYPLUS_BILLING_WEBHOOK_SECRET = "a/b" + "x".repeat(20);
    await mount();
    const res = await request(app)
      .post(`/webhook/billing/payplus/${encodeURIComponent("a/b" + "y".repeat(20))}`)
      .send({ status_code: "000", more_info: "biz1:premium" });
    // 404, not 401: the endpoint denies its own existence to anyone without the secret, so a
    // scanner learns nothing from probing it. Same status a bad path gives.
    expect(res.status).toBe(404);
  });
});
