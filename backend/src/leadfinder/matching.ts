/** Normalizes a business name for fuzzy comparison: lowercase, strip punctuation, collapse
 * whitespace. Works for Hebrew and Latin names alike since it's just punctuation/whitespace. */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/["'׳״.,\-_/\\()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 0-100 similarity score between two business names: 100 for an exact normalized match, else the
 * Jaccard overlap of their word sets (so "מספרת שרה" vs "מספרת שרה בע"מ" still scores well without
 * needing a real fuzzy-string library for this one narrow use). */
export function nameSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;

  const wordsA = new Set(na.split(" ").filter((w) => w.length > 1));
  const wordsB = new Set(nb.split(" ").filter((w) => w.length > 1));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let shared = 0;
  for (const w of wordsA) if (wordsB.has(w)) shared++;
  const union = new Set([...wordsA, ...wordsB]).size;
  return Math.round((shared / union) * 100);
}
