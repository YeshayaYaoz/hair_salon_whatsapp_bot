import type { PaymentProvider, PaymentCredentials, CreatePaymentLinkParams, PaymentLinkResult, VerifyResult } from "./types.js";
import { payplusProvider } from "./payplus.js";

// "Managed" option for businesses without their own payment/clearing account: Tori processes the
// charge through its OWN PayPlus merchant account instead, for an extra monthly surcharge (see
// TORI_MANAGED_PAYMENT_SURCHARGE_ILS in subscriptionBillingJob.ts). No salon credentials involved
// here at all — creds is ignored and Tori's own TORI_MANAGED_PAYMENT_* env vars are used instead.
// NOTE: settlement/reconciliation across multiple salons sharing one merchant account, and
// correctly attributing each transaction back to the right salon for accounting purposes, needs
// real design work before this goes live with real money — this is a functional skeleton.
export class ToriManagedPaymentNotConfiguredError extends Error {
  constructor() {
    super("TORI_MANAGED_PAYMENT_API_KEY/TORI_MANAGED_PAYMENT_SECRET_KEY are not set");
    this.name = "ToriManagedPaymentNotConfiguredError";
  }
}

function managedCreds(): PaymentCredentials {
  const apiKey = process.env.TORI_MANAGED_PAYMENT_API_KEY;
  const apiSecret = process.env.TORI_MANAGED_PAYMENT_SECRET_KEY;
  if (!apiKey || !apiSecret) throw new ToriManagedPaymentNotConfiguredError();
  return { apiKey, apiSecret };
}

export const toriManagedPaymentProvider: PaymentProvider = {
  async createPaymentLink(_creds: PaymentCredentials, params: CreatePaymentLinkParams): Promise<PaymentLinkResult> {
    return payplusProvider.createPaymentLink(managedCreds(), params);
  },
  async verifyCredentials(_creds: PaymentCredentials): Promise<VerifyResult> {
    // Nothing for the business to verify — it's Tori's own account. Just confirm we're configured.
    try {
      managedCreds();
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Not configured" };
    }
  },
};
