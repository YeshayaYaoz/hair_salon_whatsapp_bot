import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET!;

export interface AuthedRequest extends Request {
  businessId?: string;
}

export function signBusinessToken(businessId: string): string {
  return jwt.sign({ businessId }, JWT_SECRET, { expiresIn: "7d" });
}

/** How long a takeover lasts when the operator doesn't say. An hour was short enough that a session
 * routinely died mid-task — setting a salon up, walking an owner through a problem on the phone —
 * and every expiry means dropping what you were doing to re-enter from the admin panel. */
export const DEFAULT_IMPERSONATION_HOURS = 8;

/** Ceiling on a requested duration. This token is unrestricted access to someone else's business,
 * so it stays a support session with an end, not a standing key: past a working day, re-taking over
 * (which is one click, and re-logged in the audit trail) is the right way to continue. */
export const MAX_IMPERSONATION_HOURS = 24;

/**
 * Token for a super admin viewing a business's dashboard as them, for support.
 *
 * The impersonatedBy claim isn't checked anywhere server-side (auth behaves identically to a normal
 * token) — it exists so the admin panel's client can decode it and show a "you are impersonating"
 * banner, and so it's visible on the token itself if ever inspected during a support incident.
 *
 * Duration is clamped rather than trusted: it arrives from a request body, and an unbounded value
 * here would mint a permanent credential for another business.
 */
export function signImpersonationToken(businessId: string, adminEmail: string, hours = DEFAULT_IMPERSONATION_HOURS): string {
  const clamped = Math.min(Math.max(Math.round(hours) || DEFAULT_IMPERSONATION_HOURS, 1), MAX_IMPERSONATION_HOURS);
  return jwt.sign({ businessId, impersonatedBy: adminEmail }, JWT_SECRET, { expiresIn: `${clamped}h` });
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as { businessId: string };
    req.businessId = payload.businessId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
