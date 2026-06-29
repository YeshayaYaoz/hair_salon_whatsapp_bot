import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET!;

export interface AuthedRequest extends Request {
  businessId?: string;
}

export function signBusinessToken(businessId: string): string {
  return jwt.sign({ businessId }, JWT_SECRET, { expiresIn: "7d" });
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
