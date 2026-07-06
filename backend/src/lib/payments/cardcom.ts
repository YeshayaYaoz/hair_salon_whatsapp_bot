import type { PaymentProvider, PaymentCredentials, CreatePaymentLinkParams, PaymentLinkResult } from "./types.js";

// Cardcom LowProfile payment page. apiKey = TerminalNumber, apiSecret = ApiName/API password.
// Docs: https://www.cardcom.solutions/API/ — CreateLowProfile.
const BASE_URL = "https://secure.cardcom.solutions/api/v11";

export const cardcomProvider: PaymentProvider = {
  async createPaymentLink(creds: PaymentCredentials, params: CreatePaymentLinkParams): Promise<PaymentLinkResult> {
    const res = await fetch(`${BASE_URL}/LowProfile/Create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        TerminalNumber: creds.apiKey,
        ApiName: creds.apiSecret,
        Operation: "ChargeOnly",
        Amount: params.amountIls,
        ISOCoinId: 1, // ILS
        ProductName: params.description,
        ReturnValue: params.referenceId, // echoed back on the result/webhook for correlation
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
};
