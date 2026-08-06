import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";

// auth.ts reads JWT_SECRET at module scope, so this has to be set before the import below — a
// beforeAll would run after it and every sign() would throw "secretOrPrivateKey must have a value".
process.env.JWT_SECRET = "test-secret-for-impersonation";

const { signImpersonationToken, DEFAULT_IMPERSONATION_HOURS, MAX_IMPERSONATION_HOURS } = await import("./auth.js");

/** Hours of life left on the token, rounded — exp/iat are whole seconds. */
function lifetimeHours(token: string): number {
  const { exp, iat } = jwt.decode(token) as { exp: number; iat: number };
  return Math.round((exp - iat) / 3600);
}

/**
 * This token is unrestricted access to someone else's business. The duration reaches the signer
 * from a request body, so the clamp is the only thing between a support session and a standing
 * key for another account.
 */
describe("signImpersonationToken", () => {
  it("lasts a working day by default", () => {
    // An hour meant sessions died mid-task — setting a salon up, or walking an owner through a fix.
    expect(lifetimeHours(signImpersonationToken("biz1", "admin@tori.co"))).toBe(DEFAULT_IMPERSONATION_HOURS);
  });

  it("honours a shorter duration", () => {
    expect(lifetimeHours(signImpersonationToken("biz1", "admin@tori.co", 1))).toBe(1);
  });

  it("caps a longer one instead of trusting it", () => {
    expect(lifetimeHours(signImpersonationToken("biz1", "admin@tori.co", 24 * 365))).toBe(MAX_IMPERSONATION_HOURS);
  });

  it("refuses to mint a zero or negative lifetime", () => {
    // Both would otherwise produce an already-expired or absurd token rather than a usable session.
    expect(lifetimeHours(signImpersonationToken("biz1", "admin@tori.co", 0))).toBe(DEFAULT_IMPERSONATION_HOURS);
    expect(lifetimeHours(signImpersonationToken("biz1", "admin@tori.co", -5))).toBe(1);
  });

  it("keeps carrying who is impersonating, for the banner and the audit trail", () => {
    const payload = jwt.decode(signImpersonationToken("biz1", "admin@tori.co", 8)) as Record<string, unknown>;
    expect(payload.businessId).toBe("biz1");
    expect(payload.impersonatedBy).toBe("admin@tori.co");
  });
});
