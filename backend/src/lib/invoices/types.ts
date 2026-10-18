export const INVOICE_PROVIDERS = ["greeninvoice", "icount", "ypay", "payplus-invoice", "tori_managed"] as const;
export type InvoiceProviderName = (typeof INVOICE_PROVIDERS)[number];

export interface InvoiceCredentials {
  apiKey: string;
  apiSecret: string;
}

/** How the money arrived. A receipt states this; "credit card" on a cash payment is a wrong document. */
export type PaymentMethod = "card" | "cash" | "transfer" | "app" | "other";

export interface CreateReceiptParams {
  amountIls: number;
  description: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  /** Defaults to "other" for a manual receipt and "card" for one following an online payment. */
  paymentMethod?: PaymentMethod;
}

export interface ReceiptResult {
  documentUrl: string;
  providerDocumentId: string;
}

export interface VerifyResult {
  valid: boolean;
  error?: string;
}

/** Uniform surface every Israeli invoicing provider adapter implements — issues a customer-facing
 * חשבונית/קבלה after a successful payment, using that business's own connected account. */
export interface InvoiceProvider {
  createReceipt(creds: InvoiceCredentials, params: CreateReceiptParams): Promise<ReceiptResult>;
  /** Lightweight authenticated call to confirm the credentials actually work, run once at
   * connect-time so a typo/bad key is caught immediately instead of on the first real receipt. */
  verifyCredentials(creds: InvoiceCredentials): Promise<VerifyResult>;
}
