/**
 * Country dialling codes offered beside a phone input.
 *
 * Short on purpose: Israel plus the places owners actually have second numbers in. A full ITU list
 * makes the common choice harder to find, and any country missing from it can still be reached by
 * typing the number in full international form ("+353…"), which overrides the dropdown anyway.
 *
 * Ordered longest-code-first so `dialCodeOf` cannot match "1" on a number that is really "1-758".
 */
export const DIAL_CODES: { code: string; label: string; he: string }[] = [
  { code: "972", label: "Israel", he: "ישראל" },
  { code: "44", label: "UK", he: "בריטניה" },
  { code: "33", label: "France", he: "צרפת" },
  { code: "49", label: "Germany", he: "גרמניה" },
  { code: "39", label: "Italy", he: "איטליה" },
  { code: "34", label: "Spain", he: "ספרד" },
  { code: "31", label: "Netherlands", he: "הולנד" },
  { code: "32", label: "Belgium", he: "בלגיה" },
  { code: "41", label: "Switzerland", he: "שווייץ" },
  { code: "43", label: "Austria", he: "אוסטריה" },
  { code: "30", label: "Greece", he: "יוון" },
  { code: "357", label: "Cyprus", he: "קפריסין" },
  { code: "380", label: "Ukraine", he: "אוקראינה" },
  { code: "7", label: "Russia", he: "רוסיה" },
  { code: "27", label: "South Africa", he: "דרום אפריקה" },
  { code: "61", label: "Australia", he: "אוסטרליה" },
  { code: "1", label: "US / Canada", he: "ארה״ב / קנדה" },
];

export const DEFAULT_DIAL_CODE = "972";

/**
 * Best-guess country for a stored number, for re-populating the dropdown on load.
 *
 * The saved number is fully qualified, so the code is in it — this only has to find which one.
 * Ambiguity is unavoidable (+1 is a dozen countries) and harmless: the dropdown is an input aid,
 * and the digits it re-derives are the same ones already saved.
 */
export function dialCodeOf(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return DEFAULT_DIAL_CODE;
  const match = [...DIAL_CODES]
    .sort((a, b) => b.code.length - a.code.length)
    .find((c) => digits.startsWith(c.code));
  return match?.code ?? DEFAULT_DIAL_CODE;
}

/** The number without its country code, which is what belongs in the text box beside the select. */
export function localPartOf(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const code = dialCodeOf(digits);
  return digits.startsWith(code) ? digits.slice(code.length) : digits;
}

