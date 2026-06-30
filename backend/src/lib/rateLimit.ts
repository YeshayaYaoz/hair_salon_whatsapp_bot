import type { Request, Response, NextFunction } from "express";

/**
 * Minimal in-memory sliding-window rate limiter, keyed by IP (or a custom key).
 * Fine for a single-instance deployment; swap for a Redis-backed limiter when scaling
 * to multiple backend instances, since counts here aren't shared across processes.
 */
export function rateLimit(options: { windowMs: number; max: number; keyPrefix: string; message?: string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${options.keyPrefix}:${req.ip}`;
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (entry.count >= options.max) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({ error: options.message ?? "Too many requests, please try again later." });
    }

    entry.count += 1;
    next();
  };
}
