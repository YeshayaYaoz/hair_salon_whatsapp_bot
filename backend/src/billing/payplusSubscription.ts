/**
 * Tori's own recurring subscription billing via PayPlus tokens — replaces a standing-order
 * (הוראת קבע) module with a cron-driven charge against a saved token, matching the pattern:
 * generate a payment link that also captures a reusable token → charge that token on schedule.
 *
 * This uses Tori's OWN PayPlus merchant account (PAYPLUS_API_KEY/PAYPLUS_SECRET_KEY env vars) —
 * unrelated to the per-business paymentProvider connection in lib/payments/, which is for a
 * salon charging *their* customers, not for Tori charging the salon.
 */

import { randomBytes } from "crypto";
import { prisma } from "../lib/prisma.js";

const GRAPH_VERSION = "v1.0";
// Sandbox and production are different hosts. PayPlus issues separate keys for each, so pointing
// PAYPLUS_ENV at "sandbox" and pasting the staging keys exercises the whole flow — including a real
// callback — without charging a card.
const BASE_URL =
  process.env.PAYPLUS_ENV === "sandbox"
    ? `https://restapidev.payplus.co.il/api/${GRAPH_VERSION}`
    : `https://restapi.payplus.co.il/api/${GRAPH_VERSION}`;

export const PLAN_PRICES_ILS: Record<string, number> = { standard: 149, premium: 299 };
// Annual plan: 10 months' worth charged upfront (2 months free) — a common SaaS annual incentive.
export const ANNUAL_MONTHS_CHARGED = 10;
export const BILLING_PERIOD_DAYS: Record<string, number> = { monthly: 30, annual: 365 };
// Auto-applied loyalty discount once a business has completed this many successful monthly
// charges on Premium — rewards tenure without requiring the owner to ask for it.
export const LOYALTY_DISCOUNT_AFTER_CYCLES = 6;
export const LOYALTY_DISCOUNT_ILS = 50;

// Surcharge added to the monthly/annual subscription charge for businesses using Tori's own
// managed payment/invoice account instead of connecting their own (see lib/payments/toriManaged.ts
// and lib/invoices/toriManaged.ts) — covers the extra processing/accounting overhead.
export const MANAGED_PAYMENT_SURCHARGE_ILS = 49;
export const MANAGED_INVOICE_SURCHARGE_ILS = 39;

export function planPriceForCycle(plan: string, cycle: string): number {
  const base = PLAN_PRICES_ILS[plan];
  if (!base) throw new Error(`Unknown plan: ${plan}`);
  return cycle === "annual" ? base * ANNUAL_MONTHS_CHARGED : base;
}

export class PayPlusBillingNotConfiguredError extends Error {
  constructor() {
    super("PAYPLUS_API_KEY / PAYPLUS_SECRET_KEY / PAYPLUS_PAGE_UID are not all set — subscription billing is unavailable");
    this.name = "PayPlusBillingNotConfiguredError";
  }
}

function creds() {
  const apiKey = process.env.PAYPLUS_API_KEY;
  const secretKey = process.env.PAYPLUS_SECRET_KEY;
  // PayPlus rejects generateLink outright without a payment page uid:
  //   405 not-authorize-missing-payment-page-uid
  // There is no "default page" fallback — the uid identifies which of the merchant's configured
  // payment pages to render, and it is required on every call.
  const pageUid = process.env.PAYPLUS_PAGE_UID;
  if (!apiKey || !secretKey || !pageUid) throw new PayPlusBillingNotConfiguredError();
  return { apiKey, secretKey, pageUid };
}

/** Generates a hosted payment page that both charges the first period and stores a reusable
 * token for future charges.
 *
 * charge_method is 1 (a normal charge) with create_token — NOT 3.
 *
 * PayPlus's charge_method 3 is their own standing-order product: they hold the schedule and decide
 * when to charge, and it needs the "recurring payment" permission enabled on the account. We don't
 * want that. We want the card stored and a token handed back, so our own billing job decides when
 * and how much — which is what makes loyalty discounts, plan switches and mid-cycle proration
 * possible. `create_token` is a separate flag from charge_method and does exactly that.
 *
 * more_info is capped at 19 characters by PayPlus, which a cuid alone exceeds — so it carries a
 * short random reference and the plan/cycle are parked on the business row for the webhook to read.
 */
export async function createSubscriptionCheckoutLink(businessId: string, plan: string, returnUrl: string, cycle: "monthly" | "annual" = "monthly"): Promise<string> {
  const amountIls = planPriceForCycle(plan, cycle);
  const { apiKey, secretKey, pageUid } = creds();

  const planLabel = plan === "premium" ? "Premium" : "Standard";
  const cycleLabel = cycle === "annual" ? "שנתי" : "חודשי";

  // 16 hex chars, comfortably inside the 19-character limit.
  const checkoutRef = randomBytes(8).toString("hex");
  const business = await prisma.business.update({
    where: { id: businessId },
    data: { checkoutRef, checkoutPlan: plan, checkoutCycle: cycle },
    select: { name: true, email: true },
  });

  const webhookSecret = process.env.PAYPLUS_BILLING_WEBHOOK_SECRET;
  const appUrl = (process.env.API_PUBLIC_URL ?? process.env.APP_URL ?? "").replace(/\/$/, "");

  const res = await fetch(`${BASE_URL}/PaymentPages/generateLink`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: JSON.stringify({ api_key: apiKey, secret_key: secretKey }),
    },
    body: JSON.stringify({
      payment_page_uid: pageUid,
      charge_method: 1,
      create_token: true,
      amount: amountIls,
      currency_code: "ILS",
      sendEmailApproval: true,
      sendEmailFailure: false,
      // Server-to-server notification. Without it the only signal a payment succeeded is the
      // customer's browser landing on refURL_success — so anyone who closes the tab after paying
      // is charged and never activated.
      ...(appUrl && webhookSecret ? { refURL_callback: `${appUrl}/webhook/billing/payplus/${webhookSecret}` } : {}),
      // PayPlus issues the receipt itself once "חשבונית+" is enabled on the account, which is why
      // the customer object below is mandatory rather than nice-to-have.
      initial_invoice: true,
      customer: { customer_name: business.name, email: business.email },
      more_info: checkoutRef,
      refURL_success: returnUrl,
      items: [{ name: `תורי — מנוי ${planLabel} (${cycleLabel})`, quantity: 1, price: amountIls }],
    }),
  });

  if (!res.ok) throw new Error(`PayPlus generateLink failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { data?: { payment_page_link?: string }; results?: { status?: string; description?: string } };
  if (body.results?.status && body.results.status !== "success") {
    throw new Error(`PayPlus rejected the request: ${body.results.description ?? "unknown error"}`);
  }
  if (!body.data?.payment_page_link) throw new Error("PayPlus response missing payment_page_link");
  return body.data.payment_page_link;
}

/** Charges a previously-saved recurring token — used both by the nightly billing cron and by
 * immediate upgrade/downgrade proration charges. */
export async function chargeSubscriptionToken(token: string, amountIls: number, description: string): Promise<{ success: boolean; transactionId?: string; error?: string }> {
  const { apiKey, secretKey } = creds();

  // NOTE: verify this exact path against current PayPlus API docs before going live — token-charge
  // endpoints on payment gateways are the part most likely to have shifted since this was written.
  const res = await fetch(`${BASE_URL}/Transactions/ChargeByToken`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: JSON.stringify({ api_key: apiKey, secret_key: secretKey }),
    },
    body: JSON.stringify({ token, amount: amountIls, currency_code: "ILS", more_info: description }),
  });

  if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${await res.text()}` };
  const body = (await res.json()) as { data?: { transaction_uid?: string }; results?: { status?: string; description?: string } };
  if (body.results?.status && body.results.status !== "success") {
    return { success: false, error: body.results.description ?? "unknown error" };
  }
  return { success: true, transactionId: body.data?.transaction_uid };
}
