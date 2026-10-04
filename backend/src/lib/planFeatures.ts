/**
 * What each plan includes, as code rather than as a pricing card.
 *
 * The Receipts plan is the first plan that is not "the bot plus more": it is a business that only
 * wants receipts sent to its customers on a schedule, at ₪75 a month, and does not want a bot
 * answering its customers at all. Everything the bot would do for a customer is off on it; the
 * owner's own WhatsApp line to Tori — the manager tools — stays, because confirming "the money
 * came in" from WhatsApp is the whole point.
 */
export const RECEIPTS_PLAN = "receipts";

/** Whether customers writing to the business's number get the bot. */
export function planHasBot(plan: string | null | undefined): boolean {
  return plan !== RECEIPTS_PLAN;
}
