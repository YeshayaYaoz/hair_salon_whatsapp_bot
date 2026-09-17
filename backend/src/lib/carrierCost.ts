import { USD_TO_ILS } from "./usageLedger.js";

/**
 * What a business's phone line costs Tori at the carrier.
 *
 * Every business's number — the one WhatsApp runs on, and the voice bot with it — is a Zadarma
 * rental at a flat monthly fee. It is the one cost per business that has nothing to do with
 * usage: a salon that took no bookings this month cost exactly as much as one that took a
 * hundred. The admin panel showed tokens, WhatsApp messages and voice minutes, all metered, and
 * left this fixed line out — so a business with light usage read as nearly free when it was not.
 *
 * Flat, not read from Zadarma per number: the carrier's own list carries each number's monthly_fee
 * and the renewal job records it, but the panel is a monthly cost view and this is a monthly
 * price. If the plan ever changes, this is the one place to change it.
 */
export const CARRIER_USD_PER_NUMBER_MONTH = 3;

/** Agorot per month for one line, or zero for a business with no number yet. */
export function carrierCostAgorotMonth(hasNumber: boolean): number {
  return hasNumber ? Math.round(CARRIER_USD_PER_NUMBER_MONTH * USD_TO_ILS * 100) : 0;
}
