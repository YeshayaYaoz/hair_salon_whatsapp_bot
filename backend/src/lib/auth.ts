import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET!;

export interface AuthedRequest extends Request {
  businessId?: string;
}

export function signBusinessToken(businessId: string): string {
  return jwt.sign({ businessId }, JWT_SECRET, { expiresIn: "7d" });
}

/** Short-lived token for a super admin viewing a business's dashboard as them, for support. The
 * impersonatedBy claim isn't checked anywhere server-side (auth behaves identically to a normal
 * token) — it exists so the admin panel's client can decode it and show a "you are impersonating"
 * banner, and so it's visible on the token itself if ever inspected during a support incident. */
export function signImpersonationToken(businessId: string, adminEmail: string): string {
  return jwt.sign({ businessId, impersonatedBy: adminEmail }, JWT_SECRET, { expiresIn: "1h" });
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
