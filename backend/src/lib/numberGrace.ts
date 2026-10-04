/**
 * How long a business that stopped paying keeps its phone number.
 *
 * The number is the business's whole line — WhatsApp rides on it, so does the voice bot — and
 * Zadarma's own grace after a missed renewal is seven days of "parking", after which the number is
 * gone for good. A month is the window in which a lapsed salon usually sorts out its card and comes
 * back; losing the number in that window would make coming back a re-onboarding, with a new number
 * to print and a new WhatsApp to verify. So Tori keeps paying for the line for this long, and
 * releases it after. One constant, shared by the renewal job that acts on it, the dunning message
 * that promises it, and the dashboard that shows the date.
 */
export const NUMBER_GRACE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The day the hold ends, counted from when the business stopped paying. */
export function numberHeldUntil(lapsedAt: Date): Date {
  return new Date(lapsedAt.getTime() + NUMBER_GRACE_DAYS * DAY_MS);
}
