import type { InvoiceProvider, InvoiceCredentials, CreateReceiptParams, ReceiptResult, VerifyResult } from "./types.js";
import { greenInvoiceProvider } from "./greenInvoice.js";

// "Managed" option for businesses without their own invoicing account: Tori issues the receipt
// through its OWN Green Invoice account instead, for an extra monthly surcharge (see
// TORI_MANAGED_INVOICE_SURCHARGE_ILS in subscriptionBillingJob.ts). No salon credentials involved
// — creds is ignored and Tori's own TORI_MANAGED_INVOICE_* env vars are used instead.
// IMPORTANT LEGAL CAVEAT: an Israeli חשבונית/קבלה legally identifies the *seller* — a document
// issued from Tori's own Green Invoice account will show Tori as the issuing business, not the
// salon. That's fine for a salon that doesn't have (or want) its own registered invoicing setup,
// but it means these documents are NOT a substitute for the salon's own bookkeeping if they are a
// separately registered business (עוסק מורשה/פטור) — flag this clearly in the UI, this needs
// real accounting/legal review before handling real customer money.
export class ToriManagedInvoiceNotConfiguredError extends Error {
  constructor() {
    super("TORI_MANAGED_INVOICE_API_KEY/TORI_MANAGED_INVOICE_SECRET_KEY are not set");
    this.name = "ToriManagedInvoiceNotConfiguredError";
  }
}

function managedCreds(): InvoiceCredentials {
  const apiKey = process.env.TORI_MANAGED_INVOICE_API_KEY;
  const apiSecret = process.env.TORI_MANAGED_INVOICE_SECRET_KEY;
  if (!apiKey || !apiSecret) throw new ToriManagedInvoiceNotConfiguredError();
  return { apiKey, apiSecret };
}

export const toriManagedInvoiceProvider: InvoiceProvider = {
  async createReceipt(_creds: InvoiceCredentials, params: CreateReceiptParams): Promise<ReceiptResult> {
    return greenInvoiceProvider.createReceipt(managedCreds(), params);
  },
  async verifyCredentials(_creds: InvoiceCredentials): Promise<VerifyResult> {
    try {
      managedCreds();
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Not configured" };
    }
  },
};
