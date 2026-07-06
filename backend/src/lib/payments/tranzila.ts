import type { PaymentProvider, PaymentCredentials, CreatePaymentLinkParams, PaymentLinkResult, VerifyResult } from "./types.js";

// Tranzila hosted-fields payment link. apiKey = terminal name (e.g. "mystore"),
// apiSecret is not needed for a plain iframe/link (Tranzila auth for links is terminal-based);
// kept in the interface for symmetry and future direct-API (non-hosted) charges.
// Docs: https://docs.tranzila.com — TranzilaPay hosted page.
const BASE_URL = "https://direct.tranzila.com";

export const tranzilaProvider: PaymentProvider = {
  async createPaymentLink(creds: PaymentCredentials, params: CreatePaymentLinkParams): Promise<PaymentLinkResult> {
    const terminal = creds.apiKey;
    const query = new URLSearchParams({
      sum: params.amountIls.toFixed(2),
      currency: "1", // ILS
      cred_type: "1",
      pdesc: params.description,
      contact: params.customerName ?? "",
      phone: params.customerPhone ?? "",
      myid: params.referenceId, // echoed back on the notify callback for correlation
    });
    const paymentUrl = `${BASE_URL}/${encodeURIComponent(terminal)}/iframenew?${query.toString()}`;
    // Tranzila's hosted iframe doesn't return a server-side transaction id until the customer
    // actually pays (delivered via the notify webhook) — referenceId is the correlation key until then.
    return { paymentUrl, providerTransactionId: params.referenceId };
  },

  // Tranzila's hosted link doesn't call out to their API at creation time (it's just a URL), so
  // there's no server-side call to verify against without risking a real transaction attempt —
  // we only confirm the terminal name is non-empty here. A genuinely bad terminal name will only
  // surface once a customer actually tries to pay; flagged for the same reason in the UI copy.
  async verifyCredentials(creds: PaymentCredentials): Promise<VerifyResult> {
    if (!creds.apiKey.trim()) return { valid: false, error: "Terminal name is required" };
    return { valid: true };
  },
};
