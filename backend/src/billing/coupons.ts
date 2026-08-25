import { prisma } from "../lib/prisma.js";
import { PLAN_PRICES_ILS } from "./payplusSubscription.js";

/**
 * Discount codes for Tori's own subscriptions.
 *
 * Every rule about whether a code may be used, and what it is worth, lives here — the checkout
 * route, the recurring billing job and the admin screen all go through these functions rather than
 * each deciding for itself. A discount that two code paths compute differently is a discount the
 * customer sees on the checkout page and does not get on the charge.
 *
 * The redemption is deliberately split from the validation: an owner typing a code into the
 * billing page must be told immediately whether it works, but nothing may be consumed until they
 * actually pay. So `validateCoupon` is a pure read, and `redeemCoupon` runs only from the payment
 * webhook, in a transaction.
 */

export type CouponFailure =
  | "not_found"
  | "inactive"
  | "expired"
  | "exhausted"
  | "wrong_plan"
  | "already_used";

export interface CouponPreview {
  code: string;
  discountIls: number;
  /** Cycles the discount applies to; null = for as long as they stay subscribed. */
  durationCycles: number | null;
  discountType: string;
  discountValue: number;
}

export class CouponError extends Error {
  readonly reason: CouponFailure;
  constructor(reason: CouponFailure) {
    super(reason);
    this.name = "CouponError";
    this.reason = reason;
  }
}

/** Hebrew, because this text goes straight to the business owner. */
export const COUPON_FAILURE_HE: Record<CouponFailure, string> = {
  not_found: "הקוד לא נמצא. בדקו את האיות ונסו שוב.",
  inactive: "הקוד הזה כבר לא פעיל.",
  expired: "תוקף הקוד פג.",
  exhausted: "הקוד מוצה — הוא כבר נוצל במלואו.",
  wrong_plan: "הקוד לא תקף לתוכנית שבחרתם.",
  already_used: "כבר מימשתם את הקוד הזה.",
};

/** Uppercase and trimmed — the stored form. Codes are compared as data, never as user text. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * What a code is worth on a given plan, or a typed failure.
 *
 * Never mutates. Called from the billing page as the owner types, and again inside redemption —
 * re-checking there matters, because everything it validates (expiry, remaining redemptions) can
 * change between the two.
 */
export async function validateCoupon(
  rawCode: string,
  plan: string,
  businessId: string
): Promise<CouponPreview> {
  const code = normalizeCode(rawCode);
  const coupon = await prisma.coupon.findUnique({
    where: { code },
    include: { redemptions: { where: { businessId }, select: { id: true } } },
  });

  if (!coupon) throw new CouponError("not_found");
  if (!coupon.active) throw new CouponError("inactive");
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) throw new CouponError("expired");
  if (coupon.maxRedemptions !== null && coupon.redeemedCount >= coupon.maxRedemptions) {
    throw new CouponError("exhausted");
  }
  if (coupon.allowedPlans.length > 0 && !coupon.allowedPlans.includes(plan)) {
    throw new CouponError("wrong_plan");
  }
  if (coupon.redemptions.length > 0) throw new CouponError("already_used");

  return {
    code: coupon.code,
    discountIls: discountFor(coupon, plan),
    durationCycles: coupon.durationCycles,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
  };
}

/**
 * The shekel value of a coupon against a plan's list price.
 *
 * Rounded to whole shekels and clamped to the price: a 100%-off code must produce a ₪0 charge, not
 * a negative one, and PayPlus rejects a non-positive amount with an error that says nothing about
 * coupons.
 */
export function discountFor(
  coupon: { discountType: string; discountValue: number },
  plan: string
): number {
  const price = PLAN_PRICES_ILS[plan];
  if (!price) return 0;
  const raw =
    coupon.discountType === "percent"
      ? (price * coupon.discountValue) / 100
      : coupon.discountValue;
  return Math.min(price, Math.max(0, Math.round(raw)));
}

/**
 * Consumes the coupon for this business and writes the discount onto their subscription.
 *
 * Runs from the payment webhook, after the money is in. In one transaction with a conditional
 * update as the lock: the redeemedCount bump is guarded on the count still being below the cap, so
 * two businesses redeeming the last use of a code at the same moment cannot both succeed — the
 * loser gets `exhausted`, which is the truth.
 *
 * Never throws at the caller's expense: a coupon that cannot be redeemed must not undo a payment
 * that already succeeded. Returns whether it applied.
 */
export async function redeemCoupon(
  rawCode: string,
  plan: string,
  businessId: string
): Promise<{ applied: boolean; discountIls: number; reason?: CouponFailure }> {
  const code = normalizeCode(rawCode);
  try {
    return await prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon.findUnique({ where: { code } });
      if (!coupon) return { applied: false, discountIls: 0, reason: "not_found" as const };

      const discountIls = discountFor(coupon, plan);

      // The lock. `updateMany` with the cap in the WHERE clause returns count 0 for the loser of a
      // race rather than overshooting the limit.
      const claimed = await tx.coupon.updateMany({
        where: {
          id: coupon.id,
          active: true,
          ...(coupon.maxRedemptions !== null ? { redeemedCount: { lt: coupon.maxRedemptions } } : {}),
        },
        data: { redeemedCount: { increment: 1 } },
      });
      if (claimed.count === 0) return { applied: false, discountIls: 0, reason: "exhausted" as const };

      await tx.couponRedemption.create({
        data: { couponId: coupon.id, businessId, discountIls, plan },
      });
      await tx.business.update({
        where: { id: businessId },
        data: {
          couponCode: coupon.code,
          couponDiscountIls: discountIls,
          couponCyclesRemaining: coupon.durationCycles,
        },
      });

      return { applied: true, discountIls };
    });
  } catch (err) {
    // The unique constraint on (couponId, businessId) is the backstop for a double webhook: the
    // second delivery fails here rather than granting the discount twice.
    console.warn(`[coupons] Could not redeem ${code} for ${businessId}:`, err);
    return { applied: false, discountIls: 0, reason: "already_used" };
  }
}

/**
 * The coupon discount that applies to the charge happening now, and the countdown afterwards.
 *
 * Called by the recurring billing job. A coupon with durationCycles = 1 discounts the first charge
 * and nothing after it; null runs forever. The countdown is decremented only on a SUCCESSFUL
 * charge — a failed attempt that burned a discounted cycle would quietly raise the price of the
 * retry, which is the last thing a business with a declined card needs.
 */
export function couponDiscountForCharge(business: {
  couponDiscountIls: number;
  couponCyclesRemaining: number | null;
}): number {
  if (business.couponDiscountIls <= 0) return 0;
  if (business.couponCyclesRemaining === null) return business.couponDiscountIls;
  return business.couponCyclesRemaining > 0 ? business.couponDiscountIls : 0;
}

/** What to write back after a charge succeeded: counts the cycle down, and clears a spent coupon. */
export function couponStateAfterCharge(business: {
  couponDiscountIls: number;
  couponCyclesRemaining: number | null;
}): { couponDiscountIls?: number; couponCyclesRemaining?: number | null } {
  if (business.couponDiscountIls <= 0 || business.couponCyclesRemaining === null) return {};
  const remaining = Math.max(0, business.couponCyclesRemaining - 1);
  // Zeroing the discount as well as the counter means every later read is unambiguous: there is
  // exactly one representation of "no coupon", rather than a discount that is only inert because
  // a second field says so.
  return remaining === 0
    ? { couponDiscountIls: 0, couponCyclesRemaining: 0 }
    : { couponCyclesRemaining: remaining };
}
