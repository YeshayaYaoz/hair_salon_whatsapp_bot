import type { InvoiceProvider, InvoiceProviderName } from "./types.js";
import { greenInvoiceProvider } from "./greenInvoice.js";
import { icountProvider } from "./icount.js";
import { ypayProvider } from "./ypay.js";
import { payplusInvoiceProvider } from "./payplusInvoice.js";
import { toriManagedInvoiceProvider } from "./toriManaged.js";

export * from "./types.js";
export { resolveInvoiceCredentials } from "./resolve.js";

const PROVIDERS: Record<InvoiceProviderName, InvoiceProvider> = {
  greeninvoice: greenInvoiceProvider,
  icount: icountProvider,
  ypay: ypayProvider,
  "payplus-invoice": payplusInvoiceProvider,
  tori_managed: toriManagedInvoiceProvider,
};

export class UnknownInvoiceProviderError extends Error {
  constructor(name: string) {
    super(`Unknown invoice provider: ${name}`);
    this.name = "UnknownInvoiceProviderError";
  }
}

export function getInvoiceProvider(name: string): InvoiceProvider {
  const provider = PROVIDERS[name as InvoiceProviderName];
  if (!provider) throw new UnknownInvoiceProviderError(name);
  return provider;
}
