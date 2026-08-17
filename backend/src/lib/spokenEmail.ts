/**
 * An email address as a Hebrew speaker says it out loud, turned back into an address.
 *
 * A caller on a live call asked for photos by email, gave their address, and got nothing. The agent
 * told them it had failed and moved on. What reached the API was the address as spoken — "ישעיה
 * שטרודל ג'ימייל נקודה קום" — and `z.string().email()` rejected it, correctly and uselessly.
 *
 * The model is not going to reliably know that שטרודל ("strudel") is what Israelis call the @ sign;
 * it is slang, it is nowhere in an address, and a speech-to-text pass that is already working in a
 * second language will hand it over verbatim. Telling the agent about it in the prompt is worth
 * doing and is done — but a prompt is a request, and this is the same class of failure as a phone
 * number typed with spaces: the fix belongs where the value is parsed, so that it holds however the
 * words arrive.
 *
 * Safety comes from one fact: **a Hebrew letter cannot appear in an email address we would send to.**
 * So a string containing Hebrew is a dictation, not an address, and rewriting it can only improve
 * matters. Anything still holding Hebrew after the rewrite is returned as null rather than guessed
 * at — a wrong address is worse than an honest failure, because the caller waits for mail that went
 * somewhere else.
 */

/** Anything in the Hebrew block. Its presence is what marks a string as spoken rather than typed. */
const HEBREW = /[\u0590-\u05FF]/;

/**
 * A Hebrew word, bounded by things that are not Hebrew letters.
 *
 * `\b` cannot do this. JavaScript defines a word boundary over ASCII word characters only, so
 * `\bשטרודל\b` requires a transition to or from [A-Za-z0-9_] — and a Hebrew letter is not one, which
 * makes the boundary never hold. The first version of this file used `\b` throughout and every
 * Hebrew rule silently never matched, which is precisely the bug it was written to fix, one layer
 * down. Lookarounds on the Hebrew block are the version that works.
 */
const heWord = (alternatives: string) => new RegExp(`(?<![\u0590-\u05FF])(?:${alternatives})(?![\u0590-\u05FF])`, "g");

/**
 * Spoken separators. Ordered so "קו תחתון" is consumed before anything could take "קו" alone.
 *
 * "את" is deliberately absent: it is a common Hebrew word ("you", feminine) and a whole verb
 * particle, so accepting it as @ would corrupt addresses that merely contain it. שטרודל has no other
 * meaning in this context, which is exactly why it became the word for the symbol.
 */
const SEPARATORS: [RegExp, string][] = [
  [heWord("קו\\s*תחתון|אנדרסקור"), "_"],
  [/\bunderscore\b/gi, "_"],
  [heWord("שטרודל[יה]?|סטרודל"), "@"],
  [/\bstrudel\b/gi, "@"],
  [heWord("נקודה|נקודת"), "."],
  [/\bdot\b/gi, "."],
  [heWord("מקף|מינוס"), "-"],
  [/\bdash\b|\bhyphen\b/gi, "-"],
  [heWord("פלוס"), "+"],
];

/**
 * Mail providers as they are said in Hebrew. Only names whose spelling is unambiguous — a provider
 * that could plausibly be two different domains is left alone and fails validation instead.
 */
const PROVIDERS: [RegExp, string][] = [
  [heWord("ג['\u05F3\u2019]?ימייל|גימייל"), "gmail"],
  [heWord("וואלה|ואלה"), "walla"],
  [heWord("הוטמייל|הוט\\s*מייל"), "hotmail"],
  [heWord("אאוטלוק|אוטלוק"), "outlook"],
  [heWord("יאהו"), "yahoo"],
  [heWord("קום"), "com"],
  [heWord("נט"), "net"],
];

/**
 * Domains completed when the caller stopped at the provider name.
 *
 * "yeshaya@gmail" is not a valid address and is not ambiguous either. Rejecting it produces the
 * failure this whole file exists to remove, and the alternative — mail to an address that does not
 * exist — is no worse than the mail never being sent, which is today's outcome.
 */
const BARE_DOMAIN: Record<string, string> = {
  gmail: "gmail.com",
  hotmail: "hotmail.com",
  outlook: "outlook.com",
  yahoo: "yahoo.com",
  // Israeli, and .co.il rather than .com — walla.com is a different company entirely.
  walla: "walla.co.il",
};

/** Conservative, and deliberately not RFC-complete: it is a gate, not a parser. */
const LOOKS_LIKE_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * The address, or null when what arrived cannot be read as one.
 *
 * Null is a real answer here: it tells the caller's agent to ask again — spelling it out, or
 * offering WhatsApp instead — rather than sending mail into a void.
 */
export function normalizeSpokenEmail(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;

  // A typed address is already correct and must not be touched by any of the rewriting below.
  if (!HEBREW.test(s) && LOOKS_LIKE_EMAIL.test(s.replace(/\s+/g, ""))) {
    return s.replace(/\s+/g, "");
  }

  // Hebrew quotation marks (גרשיים) survive dictation of acronyms and are never part of an address.
  s = s.replace(/["'׳״]/g, "");

  for (const [pattern, replacement] of SEPARATORS) s = s.replace(pattern, replacement);
  for (const [pattern, replacement] of PROVIDERS) s = s.replace(pattern, replacement);

  // Spoken text arrives spaced around every symbol; an address has no spaces at all.
  s = s.replace(/\s+/g, "");

  // A dictated "נקודה" next to a literal "." doubles up, and a trailing one is the full stop at the
  // end of the sentence rather than part of the domain.
  s = s.replace(/\.{2,}/g, ".").replace(/^[.@-]+|[.@-]+$/g, "");

  // Anything still in Hebrew was a word this cannot decode — a name spelled out phonetically, a
  // provider not in the table. Guessing past it is how mail goes to the wrong person.
  if (HEBREW.test(s)) return null;

  const bare = s.match(/^([a-z0-9._%+-]+)@([a-z0-9-]+)$/);
  if (bare) {
    const completed = BARE_DOMAIN[bare[2]];
    if (completed) s = `${bare[1]}@${completed}`;
  }

  return LOOKS_LIKE_EMAIL.test(s) ? s : null;
}
