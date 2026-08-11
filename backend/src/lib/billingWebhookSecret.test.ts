import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The secret is a URL path segment, which is the part that makes a merely-present value not good
 * enough. A "/" or a pasted newline in it means PayPlus's callback hits a route that doesn't
 * exist — the payment is taken, nothing is activated or credited, and the only trace is a 404 in
 * someone else's logs. These check the startup output says so.
 */
describe("PAYPLUS_BILLING_WEBHOOK_SECRET validation", () => {
  const original = { ...process.env };
  let errors: string[];
  let logs: string[];

  beforeEach(() => {
    errors = [];
    logs = [];
    vi.spyOn(console, "error").mockImplementation((...a) => void errors.push(a.join(" ")));
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // validateEnv exits the process on a missing REQUIRED var; give it the ones it insists on.
    process.env.DATABASE_URL = "postgres://x";
    process.env.JWT_SECRET = "x".repeat(32);
    process.env.TOKEN_ENCRYPTION_KEY = "k".repeat(64);
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.PUBLIC_BACKEND_URL = "https://api.example.com";
    // The check under test runs after the required-vars gate, so that gate must not exit first.
    vi.spyOn(process, "exit").mockImplementation(((): never => {
      throw new Error("exit");
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...original };
  });

  async function run(secret: string | undefined) {
    vi.resetModules();
    if (secret === undefined) delete process.env.PAYPLUS_BILLING_WEBHOOK_SECRET;
    else process.env.PAYPLUS_BILLING_WEBHOOK_SECRET = secret;
    const { validateEnv } = await import("./validateEnv.js");
    try {
      validateEnv();
    } catch {
      // A process.exit stub isn't installed here; missing-required is not what these test.
    }
    return { errors: errors.join("\n"), logs: logs.join("\n") };
  }

  it("prints the exact callback URL to register when the secret is sound", async () => {
    const secret = "a".repeat(32);
    const { logs, errors } = await run(secret);
    expect(logs).toContain(`https://api.example.com/webhook/billing/payplus/${secret}`);
    expect(errors).not.toContain("unusable");
  });

  it("accepts a secret containing a slash — the callback URL encodes it", async () => {
    // This used to be reported as fatal, and on a live deploy it was the loudest line at startup:
    // "payments will be taken and nothing activated". The secret was never the problem — the URL
    // was built by interpolating it raw. Now that the callback percent-encodes it, warning about
    // it would send someone to rotate a production billing secret that works.
    const { errors } = await run("abc/def" + "x".repeat(20));
    expect(errors).not.toContain("unusable");
  });

  it("catches a pasted trailing newline", async () => {
    const { errors } = await run("a".repeat(32) + "\n");
    expect(errors).toContain("whitespace");
  });

  it("calls out a short secret — this is the only thing guarding free subscriptions", async () => {
    const { errors } = await run("short");
    expect(errors).toContain("characters");
  });

  it("says nothing extra when the secret is unset — the recommended-vars list covers that", async () => {
    const { errors } = await run(undefined);
    expect(errors).not.toContain("unusable");
  });
});
