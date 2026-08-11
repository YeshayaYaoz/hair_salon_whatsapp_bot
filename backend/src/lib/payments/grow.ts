import type { PaymentProvider, PaymentCredentials, CreatePaymentLinkParams, PaymentLinkResult, VerifyResult } from "./types.js";

// Grow (by Meshulam) hosted payment page. apiKey = user id (userId), apiSecret = page/API key.
// Docs: https://grow-il.readme.io — createPaymentProcess.
//
// This used to be the sandbox host, hardcoded, with no way to switch — while PayPlus in the
// sibling file had PAYPLUS_ENV all along. Every salon that connected Grow therefore generated
// real-looking payment links against Meshulam's sandbox and never collected a shekel, with the
// dashboard reporting "Connected" the whole time. Production is now the default, so the failure
// mode of a missing env var is a working integration rather than a silently fake one.
//
// GROW_API_BASE_URL exists because the production host is taken from Grow's public docs rather
// than from a verified live account: if Grow issues a different endpoint, this can be corrected
// with config instead of a release.
const BASE_URL =
  process.env.GROW_API_BASE_URL ??
  (process.env.GROW_ENV === "sandbox"
    ? "https://sandbox.meshulam.co.il/api/light/server/1.0"
    : "https://api.meshulam.co.il/api/light/server/1.0");

export const growProvider: PaymentProvider = {
  async createPaymentLink(creds: PaymentCredentials, params: CreatePaymentLinkParams): Promise<PaymentLinkResult> {
    const res = await fetch(`${BASE_URL}/createPaymentProcess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: creds.apiKey,
        pageCode: creds.apiSecret,
        sum: params.amountIls,
        description: params.description,
        fullName: params.customerName,
        phone: params.customerPhone,
        paymentNum: 1,
        pageField: { cField1: params.referenceId }, // echoed back on the callback for correlation
        // Grow's server-to-server callback goes ONLY to the notifyUrl passed on this request —
        // there is no account-level webhook field to fall back on. Without it the customer pays,
        // no notification is ever sent, and the deposit hold expires as if they hadn't.
        ...(params.callbackUrl ? { notifyUrl: params.callbackUrl } : {}),
      }),
    });

    if (!res.ok) throw new Error(`Grow createPaymentProcess failed (${res.status}): ${await res.text()}`);
    // status arrives as the STRING "1"/"0" — the live API answers {"status":"0"} on errors and its
    // docs show "status": "1" on success. A strict === 1 check rejected every successful response.
    const body = (await res.json()) as { status: number | string; err?: { message?: string }; data?: { url?: string; processId?: string } };
    if (Number(body.status) !== 1) throw new Error(`Grow rejected the request: ${body.err?.message ?? "unknown error"}`);
    if (!body.data?.url || !body.data?.processId) throw new Error("Grow response missing url");
    return { paymentUrl: body.data.url, providerTransactionId: body.data.processId };
  },

  // Reuses the real createPaymentProcess call with a trivial ₪1 amount — no financial side effect
  // until a customer actually completes the resulting payment page.
  async verifyCredentials(creds: PaymentCredentials): Promise<VerifyResult> {
    try {
      await growProvider.createPaymentLink(creds, { amountIls: 1, description: "Tori — בדיקת חיבור", referenceId: "verify" });
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Network error" };
    }
  },
};
