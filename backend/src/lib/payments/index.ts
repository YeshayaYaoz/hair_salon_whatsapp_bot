import type { PaymentProvider, PaymentProviderName } from "./types.js";
import { payplusProvider } from "./payplus.js";
import { tranzilaProvider } from "./tranzila.js";
import { cardcomProvider } from "./cardcom.js";
import { growProvider } from "./grow.js";

export * from "./types.js";

const PROVIDERS: Record<PaymentProviderName, PaymentProvider> = {
  payplus: payplusProvider,
  tranzila: tranzilaProvider,
  cardcom: cardcomProvider,
  grow: growProvider,
};

export class UnknownPaymentProviderError extends Error {
  constructor(name: string) {
    super(`Unknown payment provider: ${name}`);
    this.name = "UnknownPaymentProviderError";
  }
}

export function getPaymentProvider(name: string): PaymentProvider {
  const provider = PROVIDERS[name as PaymentProviderName];
  if (!provider) throw new UnknownPaymentProviderError(name);
  return provider;
}
