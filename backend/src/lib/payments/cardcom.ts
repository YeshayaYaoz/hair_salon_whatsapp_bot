import type { PaymentProvider, PaymentCredentials, CreatePaymentLinkParams, PaymentLinkResult, VerifyResult } from "./types.js";

// Cardcom LowProfile payment page. apiKey = TerminalNumber, apiSecret = ApiName/API password.
// Docs: https://www.cardcom.solutions/API/ — CreateLowProfile.
const BASE_URL = "https://secure.cardcom.solutions/api/v11";

export const cardcomProvider: PaymentProvider = {
  async createPaymentLink(creds: PaymentCredentials, params: CreatePaymentLinkParams): Promise<PaymentLinkResult> {
    // Cardcom's swagger marks SuccessRedirectUrl, FailedRedirectUrl and WebHookUrl as REQUIRED on
    // CreateLowProfile — a request without them is rejected outright, so no Cardcom salon could
    // generate a deposit link at all. The webhook URL is per-request (nothing to configure in
    // their dashboard), and the redirects land the customer on a page that says what happened;
    // Cardcom's own hosted result page is used when we have nowhere better to send them.
    const webhook = params.callbackUrl;
    const res = await fetch(`${BASE_URL}/LowProfile/Create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Their schema types TerminalNumber as an integer; a numeric string is what owners paste.
        TerminalNumber: Number(creds.apiKey),
        ApiName: creds.apiSecret,
        Operation: "ChargeOnly",
        Amount: params.amountIls,
        ISOCoinId: 1, // ILS
        ProductName: params.description,
        ReturnValue: params.referenceId, // echoed back on the result/webhook for correlation
        ...(webhook ? { WebHookUrl: webhook } : {}),
        SuccessRedirectUrl: "https://secure.cardcom.solutions/DealWasSuccessful.aspx",
        FailedRedirectUrl: "https://secure.cardcom.solutions/DealWasUnSuccessful.aspx",
        UIDefinition: { IsHideCardOwnerName: false },
      }),
    });

    if (!res.ok) throw new Error(`Cardcom CreateLowProfile failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { ResponseCode: number; Description?: string; Url?: string; LowProfileId?: string };
    if (body.ResponseCode !== 0) {
      throw new Error(`Cardcom rejected the request: ${body.Description ?? `code ${body.ResponseCode}`}`);
    }
    if (!body.Url || !body.LowProfileId) throw new Error("Cardcom response missing Url");
    return { paymentUrl: body.Url, providerTransactionId: body.LowProfileId };
  },

  // Reuses the real CreateLowProfile call with a trivial ₪1 amount — creating a low-profile
  // payment session has no financial side effect until a customer actually pays through it.
  async verifyCredentials(creds: PaymentCredentials): Promise<VerifyResult> {
    try {
      await cardcomProvider.createPaymentLink(creds, { amountIls: 1, description: "Tori — בדיקת חיבור", referenceId: "verify" });
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Network error" };
    }
  },
};
