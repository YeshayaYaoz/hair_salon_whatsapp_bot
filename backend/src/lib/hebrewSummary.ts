import Anthropic from "@anthropic-ai/sdk";

/**
 * Call summaries come from Cartesia's own post-call analysis, which writes English — and nothing
 * in the agent's configuration controls that (the agent is self-hosted; the analysis runs on
 * Cartesia's side). The dashboard then showed "The conversation contains no meaningful content…"
 * in the middle of a Hebrew page, to an owner who never asked to read English.
 *
 * Translating at INGESTION rather than at display is deliberate: the summary is stored once and
 * read many times (bot page, admin panel, any future export), and a stored Hebrew string fixes
 * every reader at once. Display-side translation would re-pay the LLM on every page load or need
 * a cache that is just this column again.
 *
 * Fail-open on every path: a summary in English is strictly better than no summary, so a missing
 * key, a network error, or an empty response all return the original text. The one thing this
 * must never do is turn a real summary into null.
 */

// The cheap tier. A one-line translation has no need for a smart model, and this runs once per
// phone call — on the busiest imaginable day that is pocket change, but only at haiku prices.
const MODEL = "claude-haiku-4-5-20251001";

const HEBREW_LETTERS = /[֐-׿]/;

export async function toHebrewSummary(text: string | null | undefined): Promise<string | null> {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  // Already Hebrew (or mixed with Hebrew) — Cartesia occasionally writes the caller's language,
  // and re-translating Hebrew through an LLM can only lose nuance.
  if (HEBREW_LETTERS.test(trimmed)) return trimmed;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return trimmed;

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system:
        "תרגם את סיכום שיחת הטלפון הבא לעברית טבעית ותמציתית. החזר את התרגום בלבד — בלי הקדמות, בלי הערות, בלי מרכאות. שמות פרטיים, מספרי טלפון ושמות שירותים נשארים כפי שהם.",
      messages: [{ role: "user", content: trimmed }],
    });
    const block = response.content[0];
    const translated = block?.type === "text" ? block.text.trim() : "";
    return translated || trimmed;
  } catch (err) {
    console.warn(
      `[hebrewSummary] translation failed, keeping the original: ${err instanceof Error ? err.message : err}`
    );
    return trimmed;
  }
}
