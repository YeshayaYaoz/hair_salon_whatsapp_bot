/**
 * Direction isolation for runs of neutral text inside Hebrew sentences.
 *
 * The dashboard renders under `dir="rtl"`, and the Unicode bidi algorithm reorders neutral
 * characters — dashes, parentheses, `+`, `%`, `₪` — to match the surrounding paragraph. For a
 * single number that is harmless. For a *range* it is not: the two ends swap, and the result is
 * a plausible-looking lie.
 *
 *     "אנחנו פתוחים 09:00–19:00"   displays as   "אנחנו פתוחים 19:00–09:00"
 *     "בממוצע 3–10 דקות"           displays as   "בממוצע 10–3 דקות"
 *     "(+972) 50-123-4567"         displays as   "50-123-4567 (972+)"
 *
 * Note that this is specific to the EN DASH (–). A plain hyphen (-) between two numbers is a
 * Common Separator, so `14:00-16:00` is treated as one numeric run and survives unescaped — which
 * is why several ranges elsewhere in the app are fine as they stand and were left alone.
 *
 * JSX has a better tool for this: `<bdi dir="ltr">`. Use that wherever the value is its own
 * element. This helper exists for the cases where the text is a plain string — a chat reply, a FAQ
 * answer, anything living in a data array — and there is no element to hang an attribute on. It
 * wraps the run in LEFT-TO-RIGHT ISOLATE / POP DIRECTIONAL ISOLATE, which is the string-level
 * equivalent: the run keeps its internal order and does not leak its direction outward.
 */
export function ltr(s: string): string {
  return `⁦${s}⁩`;
}
