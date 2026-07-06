import type { PaymentProvider, PaymentCredentials, CreatePaymentLinkParams, PaymentLinkResult } from "./types.js";

// Grow (by Meshulam) hosted payment page. apiKey = user id (userId), apiSecret = page/API key.
// Docs: https://grow.link/api-docs — createPaymentProcess.
const BASE_URL = "https://sandbox.meshulam.co.il/api/light/server/1.0";

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
      }),
    });

    if (!res.ok) throw new Error(`Grow createPaymentProcess failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { status: number; err?: { message?: string }; data?: { url?: string; processId?: string } };
    if (body.status !== 1) throw new Error(`Grow rejected the request: ${body.err?.message ?? "unknown error"}`);
    if (!body.data?.url || !body.data?.processId) throw new Error("Grow response missing url");
    return { paymentUrl: body.data.url, providerTransactionId: body.data.processId };
  },
};
