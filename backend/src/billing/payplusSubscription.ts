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

/**
 * What a business has already paid for but not yet used on its current plan, in whole shekels.
 *
 * Every upgrade path has to subtract this. Without it, switching to annual on day 3 of a paid
 * month means paying twice for the remaining 27 days — the customer notices, and they are right
 * to. The mid-cycle plan change already worked this way (it charges the difference in daily
 * rates); this makes the same rule apply everywhere, from one place.
 *
 * Deliberately based on the base plan price only. The loyalty discount and the managed-account
 * surcharges are unchanged by a plan or cycle switch and carry straight over, so leaving them out
 * of both sides keeps the arithmetic honest instead of crediting something that was never
 * separately charged for these days.
 *
 * Returns 0 rather than a negative number for a business with no known period end — an unknown
 * cycle must not silently become a discount.
 */
export function unusedCreditIls(
  business: { subscriptionPlan: string | null; billingCycle: string; nextBillingDate: Date | null },
  now: Date = new Date()
): number {
  if (!business.subscriptionPlan || !business.nextBillingDate) return 0;
  const base = PLAN_PRICES_ILS[business.subscriptionPlan];
  if (!base) return 0;

  const cycle = business.billingCycle === "annual" ? "annual" : "monthly";
  const periodDays = BILLING_PERIOD_DAYS[cycle];
  const paidForPeriod = planPriceForCycle(business.subscriptionPlan, cycle);

  const msRemaining = business.nextBillingDate.getTime() - now.getTime();
  // Floored at 0: a due date in the past means the period is already spent, not that they owe us.
  // Capped at the period length so a manually-pushed date cannot manufacture credit.
  const daysRemaining = Math.min(periodDays, Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000))));

  return Math.round((paidForPeriod / periodDays) * daysRemaining);
}

/** Smallest charge we will send to PayPlus. A zero or negative amount is rejected outright, and a
 * credit larger than the upgrade is not a reason to fail the upgrade — it just costs a shekel. */
export const MIN_CHARGE_ILS = 1;

/** Applies a credit to an amount without ever producing something PayPlus will reject. */
export function chargeAfterCredit(amountIls: number, creditIls: number): number {
  return Math.max(MIN_CHARGE_ILS, amountIls - creditIls);
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
export async function createSubscriptionCheckoutLink(
  businessId: string,
  plan: string,
  returnUrl: string,
  cycle: "monthly" | "annual" = "monthly",
  /** Already discounted by unusedCreditIls when this checkout is an upgrade, not a first purchase. */
  amountOverrideIls?: number
): Promise<string> {
  const fullPrice = planPriceForCycle(plan, cycle);
  const amountIls = amountOverrideIls ?? fullPrice;
  const planLabel = plan === "premium" ? "Premium" : "Standard";
  const cycleLabel = cycle === "annual" ? "שנתי" : "חודשי";
  // Named on the payment page so the owner can see why it is not the list price.
  const credited = amountIls < fullPrice ? ` — בקיזוז ₪${fullPrice - amountIls} ששולמו כבר` : "";

  return generateCheckoutPage({
    businessId,
    amountIls,
    itemName: `תורי — מנוי ${planLabel} (${cycleLabel})${credited}`,
    returnUrl,
    pending: { checkoutPurpose: "subscription", checkoutPlan: plan, checkoutCycle: cycle },
  });
}

/**
 * Hosted page for a one-off wallet top-up.
 *
 * Exists because the wallet's charge-the-saved-token path only works for a business that HAS a
 * saved token, and plenty don't: anyone activated before tokenisation was switched on, anyone
 * activated by hand from the admin panel, and anyone whose checkout returned no token (the webhook
 * activates them anyway — see its comment). For those owners "טען יתרה" simply answered "no active
 * subscription", which is both untrue from where they sit and not something they can act on.
 *
 * The page stores a token too, so the *next* top-up is a one-click token charge.
 */
export async function createWalletTopupLink(businessId: string, amountIls: number, returnUrl: string): Promise<string> {
  return generateCheckoutPage({
    businessId,
    amountIls,
    itemName: `תורי — טעינת ארנק הודעות (₪${amountIls})`,
    returnUrl,
    pending: { checkoutPurpose: "wallet", checkoutAmountIls: amountIls },
  });
}

/** Fields parked on the Business row for the webhook to read back — see the more_info note above. */
interface PendingCheckout {
  checkoutPurpose: "subscription" | "wallet";
  checkoutPlan?: string;
  checkoutCycle?: string;
  checkoutAmountIls?: number;
}

async function generateCheckoutPage(params: {
  businessId: string;
  amountIls: number;
  itemName: string;
  returnUrl: string;
  pending: PendingCheckout;
}): Promise<string> {
  const { businessId, amountIls, itemName, returnUrl } = params;
  const { apiKey, secretKey, pageUid } = creds();

  // 16 hex chars, comfortably inside the 19-character limit.
  const checkoutRef = randomBytes(8).toString("hex");
  const business = await prisma.business.update({
    where: { id: businessId },
    data: {
      checkoutRef,
      // Cleared explicitly so a stale field from an abandoned checkout of the other kind can't be
      // picked up by the webhook alongside this one's ref.
      checkoutPlan: null,
      checkoutCycle: null,
      checkoutAmountIls: null,
      ...params.pending,
    },
    select: { name: true, email: true },
  });

  const webhookSecret = process.env.PAYPLUS_BILLING_WEBHOOK_SECRET?.trim();
  const appUrl = (process.env.PUBLIC_BACKEND_URL ?? process.env.APP_URL ?? "").replace(/\/$/, "");

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
      // Percent-encoded, because this is a path segment and the secret is an opaque string nobody
      // chose with URL grammar in mind. A "/" in it silently became a path separator, a space
      // became a broken URL, and either way PayPlus's callback matched no route — so the payment
      // was taken and the subscription never activated, with the only trace a startup warning.
      // Express decodes req.params.secret, so the comparison in payplusBillingRoutes still sees
      // the raw value.
      ...(appUrl && webhookSecret
        ? { refURL_callback: `${appUrl}/webhook/billing/payplus/${encodeURIComponent(webhookSecret)}` }
        : {}),
      // PayPlus issues the receipt itself once "חשבונית+" is enabled on the account, which is why
      // the customer object below is mandatory rather than nice-to-have.
      initial_invoice: true,
      customer: { customer_name: business.name, email: business.email },
      more_info: checkoutRef,
      // Through the backend trampoline: PayPlus sends the browser here with a POST, and a Next.js
      // page answers POST with a 405 — which is what a paying customer used to see first.
      refURL_success: appUrl
        ? `${appUrl}/webhook/billing/payplus/return/redirect?to=${encodeURIComponent(returnUrl)}`
        : returnUrl,
      items: [{ name: itemName, quantity: 1, price: amountIls }],
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

export class PayPlusTerminalNotConfiguredError extends Error {
  constructor() {
    super(
      "PAYPLUS_TERMINAL_UID / PAYPLUS_CASHIER_UID are not set — charging a saved card needs them. " +
        "Both are in the PayPlus dashboard under Settings → Terminals."
    );
    this.name = "PayPlusTerminalNotConfiguredError";
  }
}

/**
 * Charges a previously-saved recurring token — used both by the nightly billing cron and by
 * immediate upgrade/downgrade proration charges.
 *
 * `Transactions/Charge` (J4) with `use_token`, per docs.payplus.co.il. The previous path here,
 * `Transactions/ChargeByToken`, does not exist: PayPlus answers a real endpoint's bad auth with
 * 422 "AUTHORIZATION HEADER IS NOT VALID", and answered that path with the same bare 403 it gives
 * `Transactions/NoSuchThing`. Every renewal would have failed after a first period that worked,
 * because the hosted checkout page uses a different, valid endpoint.
 *
 * `terminal_uid` and `cashier_uid` are required by the API and are account constants, so they come
 * from the environment like the rest of the credentials.
 */
export async function chargeSubscriptionToken(token: string, amountIls: number, description: string): Promise<{ success: boolean; transactionId?: string; error?: string }> {
  const { apiKey, secretKey } = creds();
  // Env wins when set; otherwise the values the checkout webhook captured from a real callback
  // (see payplusBillingRoutes) — which means one paid checkout configures renewals by itself.
  let terminalUid = process.env.PAYPLUS_TERMINAL_UID?.trim();
  let cashierUid = process.env.PAYPLUS_CASHIER_UID?.trim();
  if (!terminalUid || !cashierUid) {
    const stored = await prisma.systemSetting.findMany({
      where: { key: { in: ["payplus_terminal_uid", "payplus_cashier_uid"] } },
    });
    terminalUid ||= stored.find((s) => s.key === "payplus_terminal_uid")?.value;
    cashierUid ||= stored.find((s) => s.key === "payplus_cashier_uid")?.value;
  }
  if (!terminalUid || !cashierUid) throw new PayPlusTerminalNotConfiguredError();

  const res = await fetch(`${BASE_URL}/Transactions/Charge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: JSON.stringify({ api_key: apiKey, secret_key: secretKey }),
    },
    body: JSON.stringify({
      terminal_uid: terminalUid,
      cashier_uid: cashierUid,
      amount: amountIls,
      currency_code: "ILS",
      use_token: true,
      token,
      // Same receipt behaviour as the hosted checkout page: with חשבונית+ enabled on the account,
      // PayPlus issues the invoice for renewals too, not only for first purchases.
      initial_invoice: true,
      // J4 has no plain more_info field; more_info_1 is its first free-text slot.
      more_info_1: description,
    }),
  });

  if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${await res.text()}` };
  const body = (await res.json()) as {
    data?: { transaction_uid?: string; transaction?: { uid?: string } };
    results?: { status?: string; description?: string };
  };
  if (body.results?.status && body.results.status !== "success") {
    return { success: false, error: body.results.description ?? "unknown error" };
  }
  return { success: true, transactionId: body.data?.transaction_uid ?? body.data?.transaction?.uid };
}

/**
 * The ₪1 credentials check, callable from the admin health endpoint. Creating a payment link has
 * no financial effect — nobody is charged unless someone completes the page — and it exercises
 * exactly the auth + page-uid path every real checkout uses.
 */
export async function probeGenerateLink(): Promise<{ ok: boolean; url?: string; error?: string }> {
  let apiKey: string, secretKey: string, pageUid: string;
  try {
    ({ apiKey, secretKey, pageUid } = creds());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  // Same callback wiring as a real checkout. The first ₪1 test was paid WITHOUT this — the money
  // arrived, but PayPlus had nowhere to post the callback, so nothing was captured and the
  // "terminal/cashier will configure themselves" promise silently did not happen. A test page
  // that exercises less than the real flow is how every bug in this file survived.
  const webhookSecret = process.env.PAYPLUS_BILLING_WEBHOOK_SECRET?.trim();
  const appUrl = (process.env.PUBLIC_BACKEND_URL ?? process.env.APP_URL ?? "").replace(/\/$/, "");
  try {
    const res = await fetch(`${BASE_URL}/PaymentPages/generateLink`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: JSON.stringify({ api_key: apiKey, secret_key: secretKey }),
      },
      body: JSON.stringify({
        payment_page_uid: pageUid,
        charge_method: 1,
        amount: 1,
        currency_code: "ILS",
        sendEmailApproval: false,
        sendEmailFailure: false,
        more_info: "billing-health",
        // The health payment doubles as the token-path test: create_token stores the card, the
        // webhook recovers the token via Token/List (the callback never carries one) and parks it
        // as the operator's test card, and the health endpoint can then charge ₪1 through the
        // exact code renewals use. The email is what PayPlus keys the customer on — stable, so
        // every health payment lands on one customer instead of minting anonymous ones.
        create_token: true,
        ...(appUrl && webhookSecret
          ? { refURL_callback: `${appUrl}/webhook/billing/payplus/${encodeURIComponent(webhookSecret)}` }
          : {}),
        customer: { customer_name: "Tori health check", email: "billing-health@torionline.co.il" },
        items: [{ name: "תורי — בדיקת חיבור (₪1)", quantity: 1, price: 1 }],
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: { payment_page_link?: string };
      results?: { status?: string; description?: string };
      message?: string;
    };
    const ok = res.ok && body.results?.status === "success" && !!body.data?.payment_page_link;
    return ok
      ? { ok: true, url: body.data!.payment_page_link }
      : { ok: false, error: `HTTP ${res.status}: ${body.results?.description ?? body.message ?? "unknown"}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}

/** Where the token charge would take its terminal/cashier from right now — for the health page. */
export async function resolveTerminalConfig(): Promise<{
  terminalUid?: string;
  cashierUid?: string;
  source: "env" | "captured" | "missing";
}> {
  const envT = process.env.PAYPLUS_TERMINAL_UID?.trim();
  const envC = process.env.PAYPLUS_CASHIER_UID?.trim();
  if (envT && envC) return { terminalUid: envT, cashierUid: envC, source: "env" };
  const stored = await prisma.systemSetting.findMany({
    where: { key: { in: ["payplus_terminal_uid", "payplus_cashier_uid"] } },
  });
  const t = envT ?? stored.find((s) => s.key === "payplus_terminal_uid")?.value;
  const c = envC ?? stored.find((s) => s.key === "payplus_cashier_uid")?.value;
  if (t && c) return { terminalUid: t, cashierUid: c, source: "captured" };
  return { source: "missing" };
}

/**
 * The token a checkout created, fetched the only way PayPlus exposes it.
 *
 * Verified across their entire documentation: the payment-page callback, the redirect response and
 * the IPN all carry NO token field — create_token stores the card, but the token itself is only
 * retrievable via Token/List, filtered by the customer_uid that the callback DOES carry. Confirmed
 * with a real paid checkout: wallet credited, callback parsed, no token anywhere in the payload.
 *
 * Returns the newest entry when the customer has several saved cards — every one of them belongs
 * to the payer, so any is chargeable; the last list item is the most recently added.
 */
export async function fetchTokenForCustomer(terminalUid: string, customerUid: string): Promise<string | undefined> {
  return (await lookupCustomerTokens(terminalUid, customerUid)).token;
}

/**
 * Same lookup, but reporting WHY there is no token — the count and the error travel into the
 * webhook's persisted diagnostic, so "the card was not saved" is answerable from the admin health
 * page instead of from production logs. An empty list on a terminal that just processed a
 * create_token payment means the tokenization permission is off — PayPlus's own generateLink doc
 * scopes create_token with "in case you have tokenization permission", and without it the flag is
 * silently ignored.
 */
export async function lookupCustomerTokens(
  terminalUid: string,
  customerUid: string
): Promise<{ token?: string; count: number; error?: string }> {
  const { apiKey, secretKey } = creds();
  const res = await fetch(`${BASE_URL}/Token/List`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: JSON.stringify({ api_key: apiKey, secret_key: secretKey }),
      "api-key": apiKey,
      "secret-key": secretKey,
    },
    body: JSON.stringify({ terminal_uid: terminalUid, customer_uid: customerUid }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn(`[payplus] Token/List failed (${res.status}): ${text}`);
    return { count: 0, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  }
  const body = (await res.json()) as { data?: Array<{ token?: string }>; results?: { status?: string; description?: string } };
  if (body.results?.status && body.results.status !== "success") {
    return { count: 0, error: body.results.description ?? body.results.status };
  }
  const tokens = (body.data ?? []).map((t) => t.token).filter((t): t is string => Boolean(t));
  // The newest entry: every listed card belongs to this customer, the last one was added last.
  return { token: tokens[tokens.length - 1], count: tokens.length };
}
