import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";
import { rateLimit } from "./rateLimit.js";

function mockReq(ip: string): Request {
  return { ip } as Request;
}

function mockRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    headers,
    status(code: number) {
      res.statusCode = code;
      return { json: (body: unknown) => { res.body = body; return res; } };
    },
  };
  return res as unknown as Response & { statusCode?: number; body?: unknown; headers: Record<string, string> };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("rateLimit", () => {
  it("allows requests under the limit", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 3, keyPrefix: "test" });
    const next = vi.fn();
    const res = mockRes();

    limiter(mockReq("1.1.1.1"), res, next);
    limiter(mockReq("1.1.1.1"), res, next);
    limiter(mockReq("1.1.1.1"), res, next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(res.statusCode).toBeUndefined();
  });

  it("blocks the request once the limit is exceeded within the window", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 2, keyPrefix: "test" });
    const next = vi.fn();
    const res = mockRes();

    limiter(mockReq("2.2.2.2"), res, next);
    limiter(mockReq("2.2.2.2"), res, next);
    limiter(mockReq("2.2.2.2"), res, next); // 3rd request exceeds max=2

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBeDefined();
  });

  it("uses the provided custom error message when blocking", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: "test", message: "Slow down!" });
    const next = vi.fn();
    const res = mockRes();

    limiter(mockReq("3.3.3.3"), res, next);
    limiter(mockReq("3.3.3.3"), res, next);

    expect(res.body).toEqual({ error: "Slow down!" });
  });

  it("tracks separate IPs independently", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: "test" });
    const next = vi.fn();
    const resA = mockRes();
    const resB = mockRes();

    limiter(mockReq("4.4.4.4"), resA, next);
    limiter(mockReq("5.5.5.5"), resB, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(resA.statusCode).toBeUndefined();
    expect(resB.statusCode).toBeUndefined();
  });

  it("resets the count after the window elapses", () => {
    const limiter = rateLimit({ windowMs: 1000, max: 1, keyPrefix: "test" });
    const next = vi.fn();
    const res1 = mockRes();
    const res2 = mockRes();
    const res3 = mockRes();

    limiter(mockReq("6.6.6.6"), res1, next); // 1st: allowed
    limiter(mockReq("6.6.6.6"), res2, next); // 2nd: blocked (still in window)
    expect(res2.statusCode).toBe(429);

    vi.advanceTimersByTime(1001); // window elapses

    limiter(mockReq("6.6.6.6"), res3, next); // 3rd: allowed again
    expect(res3.statusCode).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(2); // req 1 and req 3, not req 2
  });

  it("keeps separate limiters (different keyPrefix) from interfering with each other", () => {
    const limiterA = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: "a" });
    const limiterB = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: "b" });
    const next = vi.fn();
    const resA = mockRes();
    const resB = mockRes();

    limiterA(mockReq("7.7.7.7"), resA, next);
    limiterB(mockReq("7.7.7.7"), resB, next); // same IP, different limiter instance — independent bucket

    expect(resA.statusCode).toBeUndefined();
    expect(resB.statusCode).toBeUndefined();
  });
});
