"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { translations, type Lang, type Translations } from "./i18n";
import { apiFetch } from "./api";
import { initClientMonitoring } from "./sentry";

interface LanguageContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Translations;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  setLang: () => {},
  t: translations.en,
});

// Vertical-specific terminology overlays. A B&B owner thinks in guests and bookings, not
// customers and appointments — rather than duplicate the whole i18n dict per vertical, apply
// ordered word substitutions over the base dict (plural forms first, since singulars are their
// substrings). Hebrew prefixes (ל/ה/ב/ש) attach directly to the word, so plain substring
// replacement covers the inflected forms too (ללקוח → לאורח).
const VOCAB_OVERRIDES: Record<string, Record<Lang, [string, string][]>> = {
  bnb: {
    he: [
      ["לקוחות", "אורחים"],
      ["לקוחה", "אורחת"],
      ["לקוח", "אורח"],
      ["תורים", "הזמנות"],
      ["התור", "ההזמנה"],
      ["תור", "הזמנה"],
    ],
    en: [
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

function applyVocab<T>(node: T, pairs: [string, string][]): T {
  if (typeof node === "string") {
    let v: string = node;
    for (const [from, to] of pairs) v = v.split(from).join(to);
    return v as T;
  }
  if (Array.isArray(node)) return node.map((item) => applyVocab(item, pairs)) as T;
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) out[key] = applyVocab(value, pairs);
    return out as T;
  }
  return node;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("he");
  const [businessType, setBusinessType] = useState<string | null>(null);

  useEffect(() => {
    const stored = (localStorage.getItem("lang") as Lang) ?? "he";
    setLangState(stored);
    applyLang(stored);
    initClientMonitoring();
    // Outside the dashboard (login/signup) this 401s — fine, base terminology applies there.
    apiFetch<{ businessType?: string | null }>("/api/business/me")
      .then((me) => setBusinessType(me.businessType ?? null))
      .catch(() => {});
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    localStorage.setItem("lang", l);
    applyLang(l);
  }

  const t = useMemo(() => {
    const base = translations[lang];
    const overrides = businessType ? VOCAB_OVERRIDES[businessType]?.[lang] : undefined;
    return overrides ? applyVocab(base, overrides) : base;
  }, [lang, businessType]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
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
