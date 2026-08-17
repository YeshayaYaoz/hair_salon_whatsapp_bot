/**
 * Matching a unit or service by the name a caller said out loud.
 *
 * Every voice tool resolved a service with `name: { equals: … , mode: "insensitive" }`, which is
 * exact matching with the case relaxed. That works when the owner's name for a thing and the
 * caller's name for it are the same string, and on a phone call they are not:
 *
 *   stored:  צימר "חיטה"          "גפן" - יחידה משפחתית
 *   spoken:  חיטה                 גפן
 *
 * A live call failed four times in a row on `Unknown service` for a unit that was sitting in the
 * database the whole time. Worse, the tool answered with the words "Unknown service" and nothing
 * else, so the model had no way to tell a wrong name from a broken tool — it retried the same
 * argument twice, then started mutating the *email address* instead, and finally gave up and told
 * the caller it would pass the request to the owner. One unmatched string cost the whole feature.
 *
 * So: exact first, then the differences that are punctuation rather than meaning, then a contained
 * name — and never a guess when two services could both be meant. Sending one unit's photos to
 * someone asking about another is worse than saying "which one?".
 */

export interface NamedService {
  name: string;
}

/**
 * The comparable core of a name: no quotes, no bracketing punctuation, collapsed whitespace.
 *
 * Owners quote their unit names (`צימר "חיטה"`) because that is how they write them on a sign. A
 * caller says the name inside the quotes, and so does the agent reading it back. None of that
 * punctuation is part of what anyone means.
 */
export function normalizeServiceName(name: string): string {
  return name
    .toLowerCase()
    // Straight and curly quotes, plus the Hebrew geresh/gershayim which arrive from both keyboards.
    .replace(/["'“”„‟‘’׳״]/g, "")
    // Bidi control marks are invisible, survive a copy-paste out of a right-to-left document, and
    // break an equality test with nothing on screen to explain why.
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .replace(/[-–—_,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ServiceMatch<T> =
  | { kind: "exact"; service: T }
  | { kind: "fuzzy"; service: T }
  | { kind: "ambiguous"; candidates: T[] }
  | { kind: "none" };

/**
 * Finds the service a caller meant, in decreasing order of confidence.
 *
 * The ambiguous case is a real answer, not a failure mode: a B&B with "יחידה משפחתית" in two unit
 * names must not have one of them chosen by whichever row came back first.
 */
export function matchServiceName<T extends NamedService>(requested: string, services: T[]): ServiceMatch<T> {
  const wanted = normalizeServiceName(requested);
  if (!wanted) return { kind: "none" };

  const exact = services.find((s) => normalizeServiceName(s.name) === wanted);
  if (exact) return { kind: "exact", service: exact };

  // Whole words only, in both directions: "גפן" is contained in `"גפן" - יחידה משפחתית`, and a
  // caller who says the whole thing should still match a service stored as just `גפן`. Substring
  // matching without the word check would let "תמר" match "תמרים" and "אנה" match "תאנה".
  const contained = services.filter((s) => {
    const stored = normalizeServiceName(s.name);
    return containsWholePhrase(stored, wanted) || containsWholePhrase(wanted, stored);
  });

  if (contained.length === 1) return { kind: "fuzzy", service: contained[0] };
  if (contained.length > 1) return { kind: "ambiguous", candidates: contained };
  return { kind: "none" };
}

/** `needle` appearing in `haystack` on word boundaries — computed on words, not on characters. */
function containsWholePhrase(haystack: string, needle: string): boolean {
  const hay = haystack.split(" ");
  const need = needle.split(" ");
  if (need.length === 0 || need.length > hay.length) return false;
  for (let i = 0; i + need.length <= hay.length; i++) {
    if (need.every((w, j) => hay[i + j] === w)) return true;
  }
  return false;
}

/**
 * What to tell the agent when the name did not resolve.
 *
 * The old answer was "Unknown service", which is true and unusable: it does not say whether the
 * tool is broken, the salon has no services, or the name was merely phrased differently — and a
 * model that cannot tell those apart retries, and then improvises. Naming the options turns a dead
 * end into the agent's next sentence.
 */
export function unknownServiceMessage(services: NamedService[]): string {
  if (services.length === 0) return "לעסק הזה אין יחידות או שירותים מוגדרים. אל תנסה שוב — הצע להעביר את הפנייה לבעלים.";
  const names = services.map((s) => s.name).join(", ");
  return `לא מצאתי יחידה בשם הזה. אלה השמות המדויקים: ${names}. שלח שוב עם אחד מהם בדיוק.`;
}

/** Same, for the case where the name fits more than one service. */
export function ambiguousServiceMessage(candidates: NamedService[]): string {
  const names = candidates.map((s) => s.name).join(", ");
  return `השם הזה מתאים ליותר מיחידה אחת: ${names}. שאל את המתקשר איזו מהן, ואז שלח שוב עם השם המדויק.`;
}
