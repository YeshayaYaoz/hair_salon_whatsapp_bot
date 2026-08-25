/**
 * Generates a one-off PayPlus payment link for an arbitrary amount.
 *
 * For money that isn't a subscription: a custom setup fee, a one-time service, an agreed price
 * that doesn't match any plan. The link is a normal PayPlus payment page — the payer enters their
 * card there and PayPlus issues the receipt.
 *
 * Usage (from backend/, against the environment holding the PayPlus credentials):
 *   railway run npx tsx scripts/payment-link.ts --amount 374.90
 *   railway run npx tsx scripts/payment-link.ts --amount 374.90 --description "הקמה אישית" --name "מספרת רונית"
 *
 * Deliberately NOT reusable by the subscription code, and deliberately different from it in three
 * ways that all matter:
 *
 *   - No create_token. A subscription link saves the card so it can be charged again every month.
 *     A one-off link must not: nobody consented to a stored card, and a token created here would
 *     sit in PayPlus attached to nothing.
 *   - No business row is touched. The subscription flow stamps checkoutRef/checkoutPlan on a
 *     business so the webhook can activate the right plan; this payment activates nothing, and
 *     writing those fields would make the webhook believe a subscription checkout is pending.
 *   - The reference is prefixed "oneoff-" so it can never collide with a real checkoutRef. The
 *     webhook looks a ref up against Business.checkoutRef, finds nothing, logs that it found
 *     nothing, and stops — which is the correct outcome, not a failure.
 */

import { randomBytes } from "node:crypto";

const BASE_URL =
  process.env.PAYPLUS_ENV === "dev"
    ? "https://restapidev.payplus.co.il/api/v1.0"
    : "https://restapi.payplus.co.il/api/v1.0";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function creds(): { apiKey: string; secretKey: string; pageUid: string } {
  const apiKey = process.env.PAYPLUS_API_KEY?.trim();
  const secretKey = process.env.PAYPLUS_SECRET_KEY?.trim();
  // PayPlus rejects generateLink outright without a payment page uid.
  const pageUid = process.env.PAYPLUS_PAGE_UID?.trim();
  if (!apiKey || !secretKey || !pageUid) {
    throw new Error(
      "PAYPLUS_API_KEY, PAYPLUS_SECRET_KEY and PAYPLUS_PAGE_UID must all be set. " +
        "Run this through `railway run` so it sees the production environment."
    );
  }
  return { apiKey, secretKey, pageUid };
}

async function main() {
  const raw = arg("amount");
  if (!raw) throw new Error('--amount is required, e.g. --amount 374.90');
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`--amount must be a positive number, got "${raw}"`);
  // Agorot are the smallest unit that exists; a third decimal would be silently rounded by the
  // processor into a charge that differs from the one printed on this link.
  if (Math.round(amount * 100) !== amount * 100) {
    throw new Error(`--amount must be whole agorot (at most 2 decimals), got "${raw}"`);
  }

  const description = arg("description") ?? "תשלום לתורי אונליין";
  const customerName = arg("name") ?? "לקוח";
  const email = arg("email");

  const { apiKey, secretKey, pageUid } = creds();
  const reference = `oneoff-${randomBytes(5).toString("hex")}`;

  const res = await fetch(`${BASE_URL}/PaymentPages/generateLink`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: JSON.stringify({ api_key: apiKey, secret_key: secretKey }),
    },
    body: JSON.stringify({
      payment_page_uid: pageUid,
      charge_method: 1, // immediate charge
      amount,
      currency_code: "ILS",
      sendEmailApproval: true,
      sendEmailFailure: false,
      initial_invoice: true,
      customer: { customer_name: customerName, ...(email ? { email } : {}) },
      more_info: reference,
      items: [{ name: description, quantity: 1, price: amount }],
    }),
  });

  if (!res.ok) throw new Error(`PayPlus generateLink failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as {
    data?: { payment_page_link?: string };
    results?: { status?: string; description?: string };
  };
  if (body.results?.status && body.results.status !== "success") {
    throw new Error(`PayPlus rejected the request: ${body.results.description ?? "unknown error"}`);
  }
  const link = body.data?.payment_page_link;
  if (!link) throw new Error("PayPlus response missing payment_page_link");

  console.log(`\n₪${amount.toFixed(2)} — ${description}`);
  console.log(`reference: ${reference}`);
  console.log(`\n${link}\n`);
  console.log("Send that link to the payer. PayPlus issues the receipt once it is paid.");
  console.log("It activates no subscription and stores no card — it is a single charge.");
}

main().catch((err) => {
  console.error("✖", (err as Error).message);
  process.exit(1);
});
