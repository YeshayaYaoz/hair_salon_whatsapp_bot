import { describe, it, expect, vi, beforeAll } from "vitest";
import type { Response } from "express";
import type { AuthedRequest } from "./auth.js";

// auth.ts reads JWT_SECRET once at module top-level scope, so it must be set BEFORE the
// module is first evaluated. A dynamic import (awaited inside beforeAll) runs after this
// assignment; a static import would be hoisted above it and see an unset secret.
process.env.JWT_SECRET = "test-jwt-secret-for-vitest";

let signBusinessToken: typeof import("./auth.js").signBusinessToken;
let requireAuth: typeof import("./auth.js").requireAuth;

beforeAll(async () => {
  const mod = await import("./auth.js");
  signBusinessToken = mod.signBusinessToken;
  requireAuth = mod.requireAuth;
});

function mockRes() {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return { json: (body: unknown) => { res.body = body; return res; } };
    },
  };
  return res as unknown as Response & { statusCode?: number; body?: unknown };
}

describe("signBusinessToken / requireAuth", () => {
  it("issues a token that requireAuth accepts and extracts businessId from", () => {
    const token = signBusinessToken("biz_123");
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthedRequest;
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.businessId).toBe("biz_123");
    expect(res.statusCode).toBeUndefined();
  });

  it("rejects a request with no Authorization header", () => {
    const req = { headers: {} } as AuthedRequest;
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Missing bearer token" });
  });

  it("rejects a header that isn't a Bearer token", () => {
    const req = { headers: { authorization: "Basic abc123" } } as AuthedRequest;
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("rejects a malformed/invalid token", () => {
    const req = { headers: { authorization: "Bearer not-a-real-jwt" } } as AuthedRequest;
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired token" });
  });

  it("rejects a token signed with a different secret", async () => {
    const jwt = (await import("jsonwebtoken")).default;
    const foreignToken = jwt.sign({ businessId: "biz_999" }, "some-other-secret");
    const req = { headers: { authorization: `Bearer ${foreignToken}` } } as AuthedRequest;
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("rejects an expired token", async () => {
    const jwt = (await import("jsonwebtoken")).default;
    const expiredToken = jwt.sign({ businessId: "biz_1" }, "test-jwt-secret-for-vitest", { expiresIn: -10 });
    const req = { headers: { authorization: `Bearer ${expiredToken}` } } as AuthedRequest;
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
