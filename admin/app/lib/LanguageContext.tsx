"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { translations, type Lang, type Translations } from "./i18n";
import { apiFetch } from "./api";
import { initClientMonitoring } from "./sentry";

interface LanguageContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Translations;
  /** The business's vertical ("bnb", "clinic", …), or null before /me resolves. Exposed here
   * because this provider already fetches it for the terminology overlay — pages that need to
   * adapt units or labels per vertical can read it instead of issuing their own request. */
  businessType: string | null;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  setLang: () => {},
  t: translations.en,
  businessType: null,
});

// Vertical-specific terminology overlays. A B&B owner thinks in guests and bookings, not
// customers and appointments — rather than duplicate the whole i18n dict per vertical, apply
// ordered word substitutions over the base dict (plural forms first, since singulars are their
// substrings). Hebrew prefixes (ל/ה/ב/ש) attach directly to the word, so plain substring
// replacement covers the inflected forms too (ללקוח → לאורח).
const VOCAB_OVERRIDES: Record<string, Record<Lang, [string, string][]>> = {
  bnb: {
    he: [
      // Phrase-level fixes must run before the single-word "תור"→"הזמנה" swap below — "תור" is
      // masculine and "הזמנה" is feminine, so a bare word swap leaves the adjective מisagreeing
      // ("תור חדש" → "הזמנה חדש" instead of "הזמנה חדשה"). List every adjective/phrase that
      // appears next to "תור" in the base dict here.
      ["תור חדש", "הזמנה חדשה"],
      ["תור רגיל", "הזמנה רגילה"],
      // "שירות" (service) → "יחידה" (unit) — a B&B's "service" is a rentable suite/unit, not a
      // treatment. Plural and phrase-level entries first, same reasoning as the תור/הזמנה block.
      ["השירותים הכי מבוקשים", "היחידות הכי מבוקשות"],
      ["הוסיפו שירותים", "הוסיפו יחידות"],
      ["שם השירות", "שם היחידה"],
      ["הוספת שירות", "הוספת יחידה"],
      ["עוד לא הוספתם שירותים", "עוד לא הוספתם יחידות"],
      ["שירותים ומחירים", "יחידות ומחירים"],
      ["מחירים ושירותים", "מחירים ויחידות"],
      ["שירותים", "יחידות"],
      ["שירות", "יחידה"],
      ["לקוחות", "אורחים"],
      ["לקוחה", "אורחת"],
      ["לקוח", "אורח"],
      ["תורים", "הזמנות"],
      ["התור", "ההזמנה"],
      ["תור", "הזמנה"],
    ],
    en: [
      ["Pricing & Services", "Pricing & Units"],
      ["Services", "Units"],
      ["Service name", "Unit name"],
      ["Add a service", "Add a unit"],
      ["No services yet", "No units yet"],
      ["services", "units"],
      ["Service", "Unit"],
      ["service", "unit"],
      ["Customers", "Guests"],
      ["customers", "guests"],
      ["Customer", "Guest"],
      ["customer", "guest"],
      ["Appointments", "Bookings"],
      ["appointments", "bookings"],
      ["Appointment", "Booking"],
      ["appointment", "booking"],
    ],
  },
};

const HEBREW_RANGE = "\\u0590-\\u05FF";
/** One-letter particles (ב/ה/ו/כ/ל/מ/ש) that glue directly onto the front of a Hebrew noun. */
const HEBREW_PREFIXES = "בהוכלמש";

/**
 * Names that legitimately start with a target word and must survive the pass untouched.
 *
 * "תורי" is the product itself — no morphological rule can tell the brand from "תור" plus a suffix,
 * so it is masked out of the substitution entirely rather than reasoned about. Without this,
 * "המנוי שלכם בתורי" reached B&B owners as "המנוי שלכם בהזמנהי".
 */
const PROTECTED_TERMS: { term: string; match: RegExp }[] = [
  // Only when the word ends there: "בתורי," is the brand, while "תורים" is just "תור" pluralised
  // and must still become "הזמנות".
  { term: "תורי", match: /תורי(?![֐-׿])/gu },
];

/**
 * One substitution, compiled to respect word starts.
 *
 * These were plain substring replacements, which is what makes "ללקוח" → "לאורח" work without
 * listing every inflection — Hebrew prefixes attach to the noun with no space. The cost is that a
 * target also matches inside unrelated words: "תור" sits inside "כפתור" (button), and the WhatsApp
 * settings page rendered "כפהזמנה", "כפהזמנהי" and "טקסט הכפהזמנה" to real owners.
 *
 * So anchor the match to a word start followed by any stacked prefixes. In "כפתור" the "תור" is
 * preceded by "פ", which is not a prefix letter, so it no longer matches — while "התור", "ללקוחות"
 * and "כשלקוח" still do. Non-Hebrew targets keep a plain word boundary.
 */
function compileVocab(pairs: [string, string][]): ((s: string) => string)[] {
  return pairs.map(([from, to]) => {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!/^[֐-׿]/.test(from)) {
      const re = new RegExp(`\\b${escaped}`, "gu");
      return (s: string) => s.replace(re, to);
    }
    const re = new RegExp(`(^|[^${HEBREW_RANGE}])([${HEBREW_PREFIXES}]{0,3})${escaped}`, "gu");
    return (s: string) => s.replace(re, (_m, boundary: string, prefix: string) => `${boundary}${prefix}${to}`);
  });
}

export function applyVocab<T>(node: T, rewrites: ((s: string) => string)[]): T {
  if (typeof node === "string") {
    // Mask protected names, run the substitutions, put them back. The sentinel uses NUL, which
    // never appears in a translation string, so it cannot itself be rewritten.
    let v: string = node;
    PROTECTED_TERMS.forEach(({ match }, i) => { v = v.replace(match, `\u0000${i}\u0000`); });
    for (const rewrite of rewrites) v = rewrite(v);
    PROTECTED_TERMS.forEach(({ term }, i) => { v = v.split(`\u0000${i}\u0000`).join(term); });
    return v as T;
  }
  if (Array.isArray(node)) return node.map((item) => applyVocab(item, rewrites)) as T;
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) out[key] = applyVocab(value, rewrites);
    return out as T;
  }
  return node;
}

export { compileVocab, VOCAB_OVERRIDES };

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("he");
  const [businessType, setBusinessType] = useState<string | null>(null);

  useEffect(() => {
    const stored = (localStorage.getItem("lang") as Lang) ?? "he";
    setLangState(stored);
    applyLang(stored);
    initClientMonitoring();
    // Only ask when there's a token to ask with. This used to fire unconditionally and 401 on
    // every landing/login/legal/booking view — a guaranteed-failing request and a console error on
    // the pages seen most often, including by salon customers. No token means no business, which
    // is exactly the base-terminology case anyway.
    if (localStorage.getItem("token")) {
      apiFetch<{ businessType?: string | null }>("/api/business/me")
        .then((me) => setBusinessType(me.businessType ?? null))
        .catch(() => {});
    }
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    localStorage.setItem("lang", l);
    applyLang(l);
  }

  const t = useMemo(() => {
    const base = translations[lang];
    const overrides = businessType ? VOCAB_OVERRIDES[businessType]?.[lang] : undefined;
    return overrides ? applyVocab(base, compileVocab(overrides)) : base;
  }, [lang, businessType]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, businessType }}>
      {children}
    </LanguageContext.Provider>
  );
}

function applyLang(l: Lang) {
  document.documentElement.lang = l;
  document.documentElement.dir = l === "he" ? "rtl" : "ltr";
}

export function useLanguage() {
  return useContext(LanguageContext);
}
