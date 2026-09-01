import {
  PLAN_PRICES_ILS,
  ANNUAL_MONTHS_CHARGED,
  MANAGED_PAYMENT_SURCHARGE_ILS,
  MANAGED_INVOICE_SURCHARGE_ILS,
  toIlsAmount,
} from "./payplusSubscription.js";
import { couponDiscountForCharge } from "./coupons.js";

/**
 * What a business's next subscription charge comes to.
 *
 * This exists because two jobs were computing it independently and disagreeing. The nightly charge
 * added the managed-account surcharges and the coupon; the "you'll be charged in two days"
 * reminder added neither — so a business on Tori's managed payment and invoicing accounts was told
 * ₪374.90 two days before ₪462.90 left their card, and a business holding a coupon was quoted more
 * than it would pay. Being told the wrong number right before a charge is the version of this that
 * costs trust, and it is exactly what a second copy of a formula produces over time.
 *
 * Lives in its own module rather than in payplusSubscription because it needs coupons.ts, which
 * already imports the price table from there.
 *
 * Returns null for a plan with no price, so callers keep their own "skip this business" handling
 * rather than charging or announcing a number derived from a missing entry.
 */
export function subscriptionChargeIls(business: {
  subscriptionPlan: string | null;
  billingCycle: string;
  loyaltyDiscountIls: number;
  couponDiscountIls?: number | null;
  couponCyclesRemaining?: number | null;
  paymentProvider?: string | null;
  invoiceProvider?: string | null;
}): number | null {
  const basePrice = business.subscriptionPlan ? PLAN_PRICES_ILS[business.subscriptionPlan] : undefined;
  if (!basePrice) return null;

  const periodMultiplier = business.billingCycle === "annual" ? ANNUAL_MONTHS_CHARGED : 1;
  const managedSurcharge =
    (business.paymentProvider === "tori_managed" ? MANAGED_PAYMENT_SURCHARGE_ILS : 0) +
    (business.invoiceProvider === "tori_managed" ? MANAGED_INVOICE_SURCHARGE_ILS : 0);
  const fullAmount = basePrice * periodMultiplier + managedSurcharge * periodMultiplier;

  // The coupon is a per-cycle discount, so an annual term gets it off each month charged — the
  // same arithmetic the checkout page quoted, which is the number the owner agreed to.
  const couponOff =
    couponDiscountForCharge({
      couponDiscountIls: business.couponDiscountIls ?? 0,
      couponCyclesRemaining: business.couponCyclesRemaining ?? null,
    }) * periodMultiplier;

  // Floor of ₪1: PayPlus rejects a zero charge, and a discount that fully covers a plan is a real
  // thing to hand someone. Clamping here rather than refusing keeps them subscribed.
  return toIlsAmount(Math.max(1, fullAmount - business.loyaltyDiscountIls - couponOff));
}
