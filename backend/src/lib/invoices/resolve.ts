import { decryptSecret } from "../crypto.js";
import type { InvoiceCredentials } from "./types.js";

interface BusinessInvoiceFields {
  invoiceProvider: string | null;
  invoiceApiKey: string | null;
  invoiceApiSecret: string | null;
  paymentProvider: string | null;
  paymentApiKey: string | null;
  paymentApiSecret: string | null;
}

/** Resolves which invoice provider a business should use and its decrypted credentials.
 * "payplus-invoice" is special-cased: it's the same PayPlus account as the payment connection,
 * not a separate credential pair, so it borrows the payment provider's keys instead. */
export function resolveInvoiceCredentials(
  business: BusinessInvoiceFields
): { provider: string; credentials: InvoiceCredentials } | null {
  if (!business.invoiceProvider) return null;

  if (business.invoiceProvider === "payplus-invoice") {
    if (business.paymentProvider !== "payplus" || !business.paymentApiKey || !business.paymentApiSecret) return null;
    return {
      provider: "payplus-invoice",
      credentials: { apiKey: decryptSecret(business.paymentApiKey), apiSecret: decryptSecret(business.paymentApiSecret) },
    };
  }

  if (!business.invoiceApiKey || !business.invoiceApiSecret) return null;
  return {
    provider: business.invoiceProvider,
    credentials: { apiKey: decryptSecret(business.invoiceApiKey), apiSecret: decryptSecret(business.invoiceApiSecret) },
  };
}
