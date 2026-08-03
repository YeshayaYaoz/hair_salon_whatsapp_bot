export const PAYMENT_PROVIDERS = ["payplus", "tranzila", "cardcom", "grow", "tori_managed"] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

export interface PaymentCredentials {
  apiKey: string;
  apiSecret: string;
  /** PayPlus's payment page uid. Required by PayPlus, ignored by every other provider. */
  pageUid?: string;
}

export interface CreatePaymentLinkParams {
  amountIls: number;
  description: string;
  customerName?: string;
  customerPhone?: string;
  /** Business-generated id (e.g. appointment id) to correlate the webhook callback later. */
  referenceId: string;
  /**
   * Where the provider should POST the result, server-to-server.
   *
   * Sent per transaction rather than relying on the account-level callback field configured in the
   * provider's dashboard. That field is single-valued, and our webhook URL carries the businessId
   * in its path — so one merchant account could only ever route deposits to one business in Tori.
   * A second business sharing the account would have its customers pay and never get a confirmed
   * booking, silently. Sending it here also means the owner has nothing to paste and nothing to
   * forget during onboarding.
   */
  callbackUrl?: string;
}

export interface PaymentLinkResult {
  paymentUrl: string;
  providerTransactionId: string;
}

export interface VerifyResult {
  valid: boolean;
  error?: string;
}

/** Uniform surface every Israeli payment/clearing provider adapter implements. Each business
 * connects its own merchant account — we never touch the money, only orchestrate the API calls. */
export interface PaymentProvider {
  /** Generates a hosted payment page URL the customer can be sent (e.g. via WhatsApp) to pay. */
  createPaymentLink(creds: PaymentCredentials, params: CreatePaymentLinkParams): Promise<PaymentLinkResult>;
  /** Lightweight authenticated call to confirm the credentials actually work, run once at
   * connect-time so a typo/bad key is caught immediately instead of on the first real charge. */
  verifyCredentials(creds: PaymentCredentials): Promise<VerifyResult>;
}
