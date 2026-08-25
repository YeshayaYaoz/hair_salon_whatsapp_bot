import { prisma } from "../lib/prisma.js";

/**
 * Discount codes a business offers ITS OWN customers — "new client 20% off", a holiday promotion,
 * a card handed out at the counter.
 *
 * Entirely separate from billing/coupons.ts, which discounts Tori's own subscriptions. Different
 * owner, different money, different audience; the only thing they share is the word.
 *
 * The bot is the main consumer: a customer types a code mid-conversation, the bot checks it here
 * and quotes the discounted price before booking. That makes two properties load-bearing:
 *
 *   - Checking must be free of side effects. A customer can mention a code three times while
 *     making up their mind, and none of those may consume a limited-use promotion.
 *   - The redemption must be tied to the appointment that used it, so a cancelled booking can
 *     give the use back rather than burning it.
 */

export type CustomerCouponFailure =
  | "not_found"
  | "inactive"
  | "expired"
  | "exhausted"
  | "wrong_service"
  | "already_used";

export interface CustomerCouponQuote {
  couponId: string;
  code: string;
  /** Shekels off this service's price. */
  discountIls: number;
  /** Price after the discount, never below zero. */
  finalPriceIls: number;
  description: string | null;
}

/** Customer-facing Hebrew — the bot says these out loud, so they are sentences, not codes. */
export const CUSTOMER_COUPON_FAILURE_HE: Record<CustomerCouponFailure, string> = {
  not_found: "הקוד הזה לא מוכר לנו.",
  inactive: "הקוד הזה כבר לא בתוקף.",
  expired: "תוקף הקוד הזה פג.",
  exhausted: "המבצע הזה כבר מוצה.",
  wrong_service: "הקוד לא תקף לשירות שבחרת.",
  already_used: "כבר השתמשת בקוד הזה בעבר.",
};

export class CustomerCouponError extends Error {
  readonly reason: CustomerCouponFailure;
  constructor(reason: CustomerCouponFailure) {
    super(reason);
    this.name = "CustomerCouponError";
    this.reason = reason;
  }
}

export function normalizeCustomerCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Digits only, so "050-123-4567" and "+972501234567" are recognised as the same person. */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function discountForPrice(
  coupon: { discountType: string; discountValue: number },
  priceIls: number
): number {
  const raw =
    coupon.discountType === "percent" ? (priceIls * coupon.discountValue) / 100 : coupon.discountValue;
  // Clamped to the price: a code worth more than the service is a free service, never a refund.
  return Math.min(priceIls, Math.max(0, Math.round(raw)));
}

/**
 * What a code is worth for this customer on this service — or a typed reason it isn't.
 *
 * Read-only. Safe to call as often as the conversation needs.
 */
export async function quoteCustomerCoupon(params: {
  businessId: string;
  code: string;
  serviceId: string;
  servicePriceIls: number;
  customerPhone: string;
}): Promise<CustomerCouponQuote> {
  const code = normalizeCustomerCode(params.code);
  const coupon = await prisma.customerCoupon.findUnique({
    where: { businessId_code: { businessId: params.businessId, code } },
  });

  if (!coupon) throw new CustomerCouponError("not_found");
  if (!coupon.active) throw new CustomerCouponError("inactive");
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) throw new CustomerCouponError("expired");
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) throw new CustomerCouponError("exhausted");
  if (coupon.serviceIds.length > 0 && !coupon.serviceIds.includes(params.serviceId)) {
    throw new CustomerCouponError("wrong_service");
  }
  if (coupon.onePerCustomer) {
    const prior = await prisma.customerCouponRedemption.findFirst({
      where: { couponId: coupon.id, customerPhone: normalizePhone(params.customerPhone) },
      select: { id: true },
    });
    if (prior) throw new CustomerCouponError("already_used");
  }

  const discountIls = discountForPrice(coupon, params.servicePriceIls);
  return {
    couponId: coupon.id,
    code: coupon.code,
    discountIls,
    finalPriceIls: Math.max(0, params.servicePriceIls - discountIls),
    description: coupon.description,
  };
}

/**
 * Consumes a use and ties it to the appointment it paid for.
 *
 * Called after the appointment row exists, so a booking that fails for any other reason leaves the
 * promotion untouched. The `usedCount` bump is guarded on the cap inside the same statement, so two
 * customers taking the last use at once cannot both succeed.
 *
 * Returns false rather than throwing when the use could not be claimed: by this point the customer
 * has a confirmed booking, and failing it over a promotion counter would be the wrong trade. The
 * appointment simply keeps the price it was quoted, and the discrepancy is visible to the owner on
 * the coupon screen.
 */
export async function redeemCustomerCoupon(params: {
  couponId: string;
  customerPhone: string;
  appointmentId: string;
  discountIls: number;
}): Promise<boolean> {
  const coupon = await prisma.customerCoupon.findUnique({
    where: { id: params.couponId },
    select: { maxUses: true },
  });
  if (!coupon) return false;

  const claimed = await prisma.customerCoupon.updateMany({
    where: {
      id: params.couponId,
      active: true,
      ...(coupon.maxUses !== null ? { usedCount: { lt: coupon.maxUses } } : {}),
    },
    data: { usedCount: { increment: 1 } },
  });
  if (claimed.count === 0) return false;

  await prisma.customerCouponRedemption.create({
    data: {
      couponId: params.couponId,
      customerPhone: normalizePhone(params.customerPhone),
      appointmentId: params.appointmentId,
      discountIls: params.discountIls,
    },
  });
  return true;
}

/**
 * Gives a use back when the booking it belonged to is cancelled.
 *
 * Without this, a customer who books with a "new client" code and cancels can never use it again,
 * and a limited promotion drains on bookings that never happened. Guarded so the counter cannot go
 * negative — a redemption already released (a double-cancel, a retried webhook) is a no-op.
 */
export async function releaseCustomerCoupon(appointmentId: string): Promise<void> {
  // Never throws at the caller. Every call site is a cancellation, and a cancellation that fails
  // because a promotion counter could not be decremented leaves the customer holding a booking
  // they asked to be rid of — far worse than a coupon use that stays spent. Logged, not raised.
  try {
    const redemption = await prisma.customerCouponRedemption.findFirst({
      where: { appointmentId },
      select: { id: true, couponId: true },
    });
    if (!redemption) return;

    await prisma.$transaction([
      prisma.customerCouponRedemption.delete({ where: { id: redemption.id } }),
      prisma.customerCoupon.updateMany({
        where: { id: redemption.couponId, usedCount: { gt: 0 } },
        data: { usedCount: { decrement: 1 } },
      }),
    ]);
  } catch (err) {
    console.error(`[customerCoupons] Could not release the coupon on appointment ${appointmentId}:`, err);
  }
}
