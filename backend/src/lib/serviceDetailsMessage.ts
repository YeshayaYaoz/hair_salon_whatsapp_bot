/**
 * The unit-details message the voice agent sends to a caller's WhatsApp, formatted for WhatsApp.
 *
 * It used to be `lines.join("\n")` over the raw database fields, and it arrived as a wall of text:
 * the owner's `description` is a single paragraph with bullets written inline ("• 3 חדרי שינה… •
 * שירותים ומקלחת אחת. • מטבח מאובזר…"), so every bullet ran into the previous sentence, and the
 * price and guest count were glued to the bottom of the same block with no visual break. On a phone
 * that is a screen and a half of unbroken grey text — the first thing a warm lead sees after asking
 * for photos.
 *
 * Nothing here rewrites the owner's words. The bullets they already typed are put on their own
 * lines, the sections are separated, and the two facts a reader scans for — which unit, what price
 * — are bolded. Everything else is theirs, verbatim.
 */

/** WhatsApp bold is a single asterisk, not Markdown's double. */
const bold = (s: string) => `*${s}*`;

/**
 * The owner's free-text description, broken where they already implied breaks.
 *
 * Owners type bullets inline because the dashboard textarea is one box and a bullet mid-sentence
 * looks fine while writing it. The "•" is the break they meant; this makes it one.
 */
export function normalizeDescription(raw: string): string {
  return (
    raw
      // Every bullet starts a line, wherever it was. The surrounding whitespace goes with it, so
      // "text. • next" does not become "text.\n•  next".
      .replace(/[ \t]*•[ \t]*/g, "\n• ")
      // Owners paste from documents; runs of blank lines arrive with the paste.
      .replace(/\r/g, "")
      .split("\n")
      .map((l) => l.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export interface ServiceDetails {
  name: string;
  description?: string | null;
  priceCents?: number | null;
  maxGuests?: number | null;
  linkUrl?: string | null;
}

/**
 * Sections separated by a blank line, because WhatsApp renders a single newline as a tight wrap and
 * the eye reads the whole thing as one paragraph.
 */
export function buildServiceDetailsMessage(service: ServiceDetails, businessName: string): string {
  const sections: string[] = [`${bold(service.name)} — ${businessName}`];

  const description = service.description?.trim();
  if (description) sections.push(normalizeDescription(description));

  // Price and capacity belong together — they are the pair a reader compares across units — and
  // they are the answer to the question that prompted the message, so they are bolded and kept out
  // of the description block.
  const facts: string[] = [];
  if (service.priceCents) facts.push(bold(`מחיר: ${Math.round(service.priceCents / 100)} ש"ח ללילה`));
  if (service.maxGuests) facts.push(`עד ${service.maxGuests} אורחים`);
  if (facts.length) sections.push(facts.join("\n"));

  // Labelled "פרטים נוספים" rather than "קישור": owners put prose in this field as often as a URL
  // (one live business has its multi-night pricing rule there), and a prose value under a link
  // label reads as a broken link.
  const link = service.linkUrl?.trim();
  if (link) sections.push(`פרטים נוספים: ${link}`);

  return sections.join("\n\n");
}
