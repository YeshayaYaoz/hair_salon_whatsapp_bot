/**
 * One place that turns a shekel amount into text a customer reads.
 *
 * Prices are no longer whole shekels, and every amount here is computed in floating point, so
 * interpolating a number straight into a message produces figures that are wrong in two different
 * ways: ₪374.90 renders as "₪374.9" (a price we do not have), and ₪174.90 less a ₪111 coupon
 * renders as "₪63.900000000000006" (a number that cannot exist). Both were going out over WhatsApp.
 *
 * Rounds to agorot first, then drops a trailing ".00" so whole amounts stay clean.
 *
 * Deliberately mirrors fmtIls in the dashboard (admin/app/dashboard/billing/page.tsx): the same
 * amount must not read differently depending on which surface shows it.
 */
export function fmtIls(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/** Same, with thousands separators — for totals large enough to need them (monthly revenue). */
export function fmtIlsGrouped(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString("he-IL", { maximumFractionDigits: 2 });
}
