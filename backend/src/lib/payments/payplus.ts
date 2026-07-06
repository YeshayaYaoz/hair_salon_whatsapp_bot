import type { PaymentProvider, PaymentCredentials, CreatePaymentLinkParams, PaymentLinkResult, VerifyResult } from "./types.js";

// PayPlus "Generate Payment Link" API. apiKey = PayPlus API Key, apiSecret = PayPlus Secret Key.
// Docs: https://restapidoc.payplus.co.il (PaymentPages/generateLink)
const BASE_URL = "https://restapi.payplus.co.il/api/v1.0";

export const payplusProvider: PaymentProvider = {
  async createPaymentLink(creds: PaymentCredentials, params: CreatePaymentLinkParams): Promise<PaymentLinkResult> {
    const res = await fetch(`${BASE_URL}/PaymentPages/generateLink`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: JSON.stringify({ api_key: creds.apiKey, secret_key: creds.apiSecret }),
      },
      body: JSON.stringify({
        payment_page_uid: undefined, // uses the merchant's default payment page
        charge_method: 1, // charge (not just token/auth)
        amount: params.amountIls,
        currency_code: "ILS",
        sendEmailApproval: true,
        sendEmailFailure: false,
        more_info: params.referenceId,
        refURL_success: undefined,
        customer: {
          customer_name: params.customerName,
          phone: params.customerPhone,
        },
        items: [{ name: params.description, quantity: 1, price: params.amountIls }],
      }),
    });

    if (!res.ok) throw new Error(`PayPlus generateLink failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { data?: { payment_page_link?: string; page_request_uid?: string }; results?: { status?: string; description?: string } };
    if (body.results?.status && body.results.status !== "success") {
      throw new Error(`PayPlus rejected the request: ${body.results.description ?? "unknown error"}`);
    }
    if (!body.data?.payment_page_link || !body.data?.page_request_uid) {
      throw new Error("PayPlus response missing payment_page_link");
    }
    return { paymentUrl: body.data.payment_page_link, providerTransactionId: body.data.page_request_uid };
  },

  // Reuses the real generateLink call with a trivial ₪1 amount — creating a payment page/link has
  // no financial side effect (nobody is charged unless a customer actually completes it), so this
  // exercises the exact same auth path as a real charge instead of guessing at a separate endpoint.
  async verifyCredentials(creds: PaymentCredentials): Promise<VerifyResult> {
    try {
      await payplusProvider.createPaymentLink(creds, { amountIls: 1, description: "Tori — בדיקת חיבור", referenceId: "verify" });
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Network error" };
    }
  },
};
