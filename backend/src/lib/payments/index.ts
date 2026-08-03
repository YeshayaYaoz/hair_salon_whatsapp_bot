import type { PaymentProvider, PaymentProviderName } from "./types.js";
import { payplusProvider } from "./payplus.js";
import { tranzilaProvider } from "./tranzila.js";
import { cardcomProvider } from "./cardcom.js";
import { growProvider } from "./grow.js";
import { toriManagedPaymentProvider } from "./toriManaged.js";

export * from "./types.js";

const PROVIDERS: Record<PaymentProviderName, PaymentProvider> = {
  payplus: payplusProvider,
  tranzila: tranzilaProvider,
  cardcom: cardcomProvider,
  grow: growProvider,
  tori_managed: toriManagedPaymentProvider,
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

/**
 * The webhook URL a provider should call back for this business's deposits.
 *
 * Kept here so the two places that create payment links and the dashboard hint all describe the
 * same address. Returns null when the business has no webhook secret yet — better to send no
 * callback than one that will be rejected.
 */
export function depositCallbackUrl(businessId: string, provider: string, webhookSecret: string | null): string | null {
  if (!webhookSecret) return null;
  const base = (process.env.PUBLIC_BACKEND_URL ?? process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  const withScheme = /^https?:\/\//i.test(base) ? base : `https://${base}`;
  return `${withScheme}/webhook/payments/${provider}/${businessId}/${webhookSecret}`;
}
