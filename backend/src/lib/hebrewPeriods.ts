import { HebrewCalendar, HDate, months, flags } from "@hebcal/core";

/**
 * Turns an owner's plain-Hebrew description of *when* ("כל ערב חג", "בין הזמנים", "חול המועד
 * סוכות") into concrete calendar dates.
 *
 * The dates come from a real Hebrew calendar computed offline (@hebcal/core), never from the LLM.
 * That distinction matters: an owner is going to price a whole season off these dates, and a model
 * asked to list "every erev chag in 2026" will produce a confident, plausible, subtly wrong list —
 * off-by-one on a festival, or a date from the wrong year. What the model is allowed to do (see
 * matchPeriodKinds' LLM fallback in scheduleRoutes) is pick *which* named period the owner meant,
 * which is a classification with a fixed, checkable answer set.
 *
 * Everything is computed for the Israeli calendar (il: true) — one day of yom tov, not two.
 */

/** A resolved, concrete date range. Dates are date-only (no time), inclusive of endDate. */
export interface ResolvedPeriod {
  /** Hebrew name of this specific occurrence, e.g. "ערב פסח", "חול המועד סוכות". */
  label: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD, inclusive */
  endDate: string;
}

/** The named periods an owner can ask for. Each is a real concept with an agreed definition. */
export const PERIOD_KINDS = [
  "erev-chag",
  "chag",
  "chol-hamoed",
  "bein-hazmanim",
  "pesach",
  "sukkot",
  "rosh-hashana",
  "yom-kippur",
  "shavuot",
  "chanukah",
  "purim",
  "summer-vacation",
] as const;

export type PeriodKind = (typeof PERIOD_KINDS)[number];

/** Hebrew names for the catalogue, shown in the dashboard and sent to the LLM as the answer set. */
export const PERIOD_KIND_LABELS: Record<PeriodKind, string> = {
  "erev-chag": "ערב חג",
  chag: "ימי חג",
  "chol-hamoed": "חול המועד",
  "bein-hazmanim": "בין הזמנים",
  pesach: "פסח",
  sukkot: "סוכות",
  "rosh-hashana": "ראש השנה",
  "yom-kippur": "יום כיפור",
  shavuot: "שבועות",
  chanukah: "חנוכה",
  purim: "פורים",
  "summer-vacation": "חופש גדול",
};

export function isPeriodKind(v: unknown): v is PeriodKind {
  return typeof v === "string" && (PERIOD_KINDS as readonly string[]).includes(v);
}

function toIso(d: Date): string {
  // Local getters, not toISOString(): these are calendar days, and a UTC conversion shifts a
  // date backwards for anything east of Greenwich — which is every business using this app.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Groups a sorted list of individual days into the fewest continuous ranges. */
function mergeConsecutive(days: { iso: string; label: string }[]): ResolvedPeriod[] {
  const sorted = [...days].sort((a, b) => a.iso.localeCompare(b.iso));
  const out: ResolvedPeriod[] = [];
  for (const day of sorted) {
    const last = out[out.length - 1];
    const dayBefore = new Date(`${day.iso}T00:00:00`);
    dayBefore.setDate(dayBefore.getDate() - 1);
    if (last && last.endDate === toIso(dayBefore)) {
      last.endDate = day.iso;
    } else {
      out.push({ label: day.label, startDate: day.iso, endDate: day.iso });
    }
  }
  return out;
}

/** Hebrew label for an event, with hebcal's vowel points stripped — owners don't type with niqqud
 * and the dashboard reads cleaner without it. */
function hebrewLabel(desc: string): string {
  return desc.replace(/[֑-ׇ]/g, "").trim();
}

/** Drops the day-number suffix so "פסח א׳" / "פסח ב׳ (חוה״מ)" all group under "פסח". */
function festivalName(desc: string): string {
  return hebrewLabel(desc)
    // "חנוכה: א׳ נר" -> "חנוכה"
    .replace(/:.*$/, "")
    .replace(/\s*\(.*?\)\s*/g, "")
    .replace(/\s+[א-ת]׳$/, "")
    .replace(/\s+\d+$/, "")
    .trim();
}

function eventsForYear(gregorianYear: number) {
  return HebrewCalendar.calendar({
    year: gregorianYear,
    isHebrewYear: false,
    numYears: 1,
    il: true, // Israeli observance: one day of yom tov
    locale: "he",
  });
}

/**
 * Bein hazmanim — the yeshiva vacation periods. These are not calendar events, so they can't come
 * out of hebcal directly; they're fixed Hebrew-date spans that different yeshivas cut slightly
 * differently. The common spans are used here, and the owner can delete or trim any row afterwards
 * rather than being stuck with one institution's definition.
 */
function beinHazmanim(hebrewYear: number): ResolvedPeriod[] {
  const span = (label: string, from: HDate, to: HDate): ResolvedPeriod => ({
    label,
    startDate: toIso(from.greg()),
    endDate: toIso(to.greg()),
  });
  return [
    // Nisan: Rosh Chodesh Nisan through a couple of days after Pesach.
    span("בין הזמנים - ניסן", new HDate(1, months.NISAN, hebrewYear), new HDate(23, months.NISAN, hebrewYear)),
    // Av: Tisha B'Av through the end of the month (Elul zman starts at Rosh Chodesh Elul).
    span("בין הזמנים - אב", new HDate(9, months.AV, hebrewYear), new HDate(29, months.AV, hebrewYear)),
    // Tishrei: erev Rosh Hashana through isru chag Sukkot.
    span("בין הזמנים - תשרי", new HDate(29, months.ELUL, hebrewYear - 1), new HDate(24, months.TISHREI, hebrewYear)),
  ];
}

/** Israeli school summer vacation: all of July and August. Fixed civil dates, not a Hebrew one. */
function summerVacation(gregorianYear: number): ResolvedPeriod[] {
  return [{ label: "חופש גדול", startDate: `${gregorianYear}-07-01`, endDate: `${gregorianYear}-08-31` }];
}

const FESTIVAL_MATCH: Record<string, RegExp> = {
  // Anchored on the day number so "Pesach Sheni" (a minor date a month later, unrelated to the
  // festival) doesn't get swept into the Pesach range.
  pesach: /^pesach [IVX]+/i,
  sukkot: /sukkot|shmini atzeret|simchat torah/i,
  "rosh-hashana": /rosh hashana/i,
  "yom-kippur": /yom kippur/i,
  shavuot: /shavuot/i,
  chanukah: /chanukah/i,
  purim: /purim|shushan/i,
};

/**
 * Resolves one named period to every occurrence of it inside a Gregorian year.
 *
 * Results outside the requested year are filtered out — a Hebrew year straddles two civil years, so
 * both overlapping Hebrew years are generated and then clipped.
 */
export function resolvePeriod(kind: PeriodKind, gregorianYear: number): ResolvedPeriod[] {
  const inYear = (p: ResolvedPeriod) => p.startDate.startsWith(String(gregorianYear)) || p.endDate.startsWith(String(gregorianYear));

  if (kind === "bein-hazmanim") {
    return [...beinHazmanim(gregorianYear + 3760), ...beinHazmanim(gregorianYear + 3761)].filter(inYear);
  }
  if (kind === "summer-vacation") return summerVacation(gregorianYear);

  const events = eventsForYear(gregorianYear);
  const days: { iso: string; label: string }[] = [];

  for (const ev of events) {
    const f = ev.getFlags();
    const desc = ev.getDesc();
    const iso = toIso(ev.getDate().greg());

    if (kind === "erev-chag") {
      // EREV alone also matches Erev Purim and Erev Tish'a B'Av, which are ordinary working days.
      // Pairing it with LIGHT_CANDLES narrows it to the eve of an actual yom tov.
      if (f & flags.EREV && f & flags.LIGHT_CANDLES) days.push({ iso, label: hebrewLabel(ev.render("he")) });
    } else if (kind === "chag") {
      if (f & flags.CHAG) days.push({ iso, label: hebrewLabel(ev.render("he")) });
    } else if (kind === "chol-hamoed") {
      if (f & flags.CHOL_HAMOED) days.push({ iso, label: `חול המועד ${festivalName(ev.render("he"))}` });
    } else {
      // The eve is its own period ("erev-chag"); a request for "פסח" means the festival itself.
      if (f & flags.EREV) continue;
      const re = FESTIVAL_MATCH[kind];
      if (re?.test(desc)) days.push({ iso, label: festivalName(ev.render("he")) });
    }
  }

  // Single-day kinds stay one row each; multi-day ones collapse into their real spans.
  const merged = mergeConsecutive(days);
  // A merged range takes the label of its first day ("פסח א׳" for the whole festival), which is
  // wrong for a span — relabel spans with the plain festival name.
  return merged.map((p) => (p.startDate === p.endDate ? p : { ...p, label: festivalName(p.label) })).filter(inYear);
}

/**
 * Maps free Hebrew text to period kinds by keyword.
 *
 * Deterministic and free, and it covers how owners actually phrase this ("כל ערב חג יקר פי 2").
 * Anything it doesn't recognise falls through to the LLM classifier at the route level, so this
 * never has to be exhaustive — only right about what it does claim.
 */
const KEYWORDS: [RegExp, PeriodKind][] = [
  [/ערב\s*חג|ערבי\s*חג/, "erev-chag"],
  [/בין\s*הזמנים|ביה"?ז/, "bein-hazmanim"],
  [/חול\s*המועד|חוה"?מ/, "chol-hamoed"],
  [/חופש\s*גדול|חופשת\s*הקיץ|קיץ/, "summer-vacation"],
  [/פסח/, "pesach"],
  [/סוכות|שמיני\s*עצרת|שמחת\s*תורה/, "sukkot"],
  [/ראש\s*השנה|ר"?ה/, "rosh-hashana"],
  [/יום\s*כיפור|כיפור|יו"?כ/, "yom-kippur"],
  [/שבועות/, "shavuot"],
  [/חנוכה/, "chanukah"],
  [/פורים/, "purim"],
  // Checked last: "חג" alone is a substring of "ערב חג", which is a different (and more specific)
  // request, so the specific pattern above must win.
  [/חגים|ימי\s*חג|בחג/, "chag"],
];

export function matchPeriodKinds(text: string): PeriodKind[] {
  const found: PeriodKind[] = [];
  for (const [re, kind] of KEYWORDS) {
    if (re.test(text) && !found.includes(kind)) found.push(kind);
  }
  // "ערב חג" implies the eve only — don't also return the festival it precedes.
  if (found.includes("erev-chag")) return found.filter((k) => k !== "chag");
  return found;
}
