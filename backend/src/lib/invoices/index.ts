import type { InvoiceProvider, InvoiceProviderName } from "./types.js";
import { greenInvoiceProvider } from "./greenInvoice.js";
import { icountProvider } from "./icount.js";

export * from "./types.js";

const PROVIDERS: Record<InvoiceProviderName, InvoiceProvider> = {
  greeninvoice: greenInvoiceProvider,
  icount: icountProvider,
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
