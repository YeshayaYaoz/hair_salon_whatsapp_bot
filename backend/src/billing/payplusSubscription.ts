/**
 * Tori's own recurring subscription billing via PayPlus tokens — replaces a standing-order
 * (הוראת קבע) module with a cron-driven charge against a saved token, matching the pattern:
 * generate a payment link that also captures a reusable token → charge that token on schedule.
 *
 * This uses Tori's OWN PayPlus merchant account (PAYPLUS_API_KEY/PAYPLUS_SECRET_KEY env vars) —
 * unrelated to the per-business paymentProvider connection in lib/payments/, which is for a
 * salon charging *their* customers, not for Tori charging the salon.
 */

const GRAPH_VERSION = "v1.0";
const BASE_URL = `https://restapi.payplus.co.il/api/${GRAPH_VERSION}`;

export const PLAN_PRICES_ILS: Record<string, number> = { standard: 149, premium: 299 };

export class PayPlusBillingNotConfiguredError extends Error {
  constructor() {
    super("PAYPLUS_API_KEY/PAYPLUS_SECRET_KEY are not set — subscription billing is unavailable");
    this.name = "PayPlusBillingNotConfiguredError";
  }
}

function creds() {
  const apiKey = process.env.PAYPLUS_API_KEY;
  const secretKey = process.env.PAYPLUS_SECRET_KEY;
  if (!apiKey || !secretKey) throw new PayPlusBillingNotConfiguredError();
  return { apiKey, secretKey };
}

/** Generates a hosted payment page that both charges the first month and stores a reusable
 * token for future recurring charges. more_info carries "<businessId>:<plan>" so the webhook
 * can attribute the resulting token to the right business/plan. */
export async function createSubscriptionCheckoutLink(businessId: string, plan: string, returnUrl: string): Promise<string> {
  const amountIls = PLAN_PRICES_ILS[plan];
  if (!amountIls) throw new Error(`Unknown plan: ${plan}`);
  const { apiKey, secretKey } = creds();

  const res = await fetch(`${BASE_URL}/PaymentPages/generateLink`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: JSON.stringify({ api_key: apiKey, secret_key: secretKey }),
    },
    body: JSON.stringify({
      charge_method: 3, // charge now AND create a reusable token
      amount: amountIls,
      currency_code: "ILS",
      sendEmailApproval: true,
      more_info: `${businessId}:${plan}`,
      refURL_success: returnUrl,
      items: [{ name: `תורי — מנוי ${plan === "premium" ? "Premium" : "Standard"}`, quantity: 1, price: amountIls }],
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
