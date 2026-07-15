import type { Response, NextFunction } from "express";
import { prisma } from "./prisma.js";
import type { AuthedRequest } from "./auth.js";

const ACTIVE_STATUSES = new Set(["trial", "active"]);

/** Blocks tenant API access once a business's subscription lapses (past_due/canceled), or once a
 * super admin has blocked the account outright (independent of billing state). */
export async function requireActiveSubscription(req: AuthedRequest, res: Response, next: NextFunction) {
  const business = await prisma.business.findUnique({ where: { id: req.businessId! } });
  if (!business || business.blockedAt) {
    return res.status(403).json({ error: "This account has been suspended. Contact support." });
  }
  if (!ACTIVE_STATUSES.has(business.subscriptionStatus)) {
    return res.status(402).json({ error: "Subscription inactive. Please update billing to continue." });
  }
  next();
}

export async function hasActiveSubscription(businessId: string): Promise<boolean> {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  return Boolean(business && !business.blockedAt && ACTIVE_STATUSES.has(business.subscriptionStatus));
}
