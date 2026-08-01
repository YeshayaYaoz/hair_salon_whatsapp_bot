import { describe, it, expect } from "vitest";
import { resolvePeriod, matchPeriodKinds, isPeriodKind, PERIOD_KINDS } from "./hebrewPeriods.js";

/**
 * The dates below were checked against the Hebrew calendar for 2026 (5786/5787, Israeli
 * observance). They're asserted exactly on purpose: this feature exists so an owner can price a
 * season off these dates, so "close enough" is a real business error, not a rounding issue.
 */
describe("resolvePeriod", () => {
  it("lists every erev chag in the year, and only actual yom tov eves", () => {
    const eves = resolvePeriod("erev-chag", 2026);
    expect(eves.map((p) => p.startDate)).toEqual([
      "2026-04-01", // ערב פסח
      "2026-05-21", // ערב שבועות
      "2026-09-11", // ערב ראש השנה
      "2026-09-20", // ערב יום כיפור
      "2026-09-25", // ערב סוכות
    ]);
    // Erev Purim and Erev Tish'a B'Av carry the same EREV flag but are ordinary working days.
    expect(eves.map((p) => p.startDate)).not.toContain("2026-03-02");
    expect(eves.map((p) => p.startDate)).not.toContain("2026-07-22");
    // Each eve is a single day, not a range.
    for (const p of eves) expect(p.startDate).toBe(p.endDate);
  });

  it("merges chol hamoed into one range per festival", () => {
    const chm = resolvePeriod("chol-hamoed", 2026);
    expect(chm).toHaveLength(2);
    expect(chm[0]).toMatchObject({ startDate: "2026-04-03", endDate: "2026-04-07" });
    expect(chm[0].label).toContain("חול המועד");
    expect(chm[1]).toMatchObject({ startDate: "2026-09-27", endDate: "2026-10-02" });
  });

  it("returns the festival itself without its eve", () => {
    const pesach = resolvePeriod("pesach", 2026);
    expect(pesach).toHaveLength(1);
    // Erev Pesach is 04-01; the festival starts on the 2nd.
    expect(pesach[0]).toMatchObject({ startDate: "2026-04-02", endDate: "2026-04-08", label: "פסח" });
  });

  it("excludes Pesach Sheni, which is a month later and unrelated", () => {
    expect(resolvePeriod("pesach", 2026).some((p) => p.startDate.startsWith("2026-05"))).toBe(false);
  });

  it("covers the three bein hazmanim periods", () => {
    const bz = resolvePeriod("bein-hazmanim", 2026);
    expect(bz.map((p) => p.label)).toEqual(
      expect.arrayContaining(["בין הזמנים - ניסן", "בין הזמנים - אב", "בין הזמנים - תשרי"])
    );
    for (const p of bz) expect(p.startDate < p.endDate).toBe(true);
  });

  it("never returns a range ending before it starts, for any kind", () => {
    for (const kind of PERIOD_KINDS) {
      for (const p of resolvePeriod(kind, 2026)) {
        expect(p.startDate <= p.endDate).toBe(true);
        expect(p.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps results inside the requested civil year", () => {
    for (const kind of PERIOD_KINDS) {
      for (const p of resolvePeriod(kind, 2026)) {
        expect(p.startDate.startsWith("2026") || p.endDate.startsWith("2026")).toBe(true);
      }
    }
  });

  it("produces different dates in a different year", () => {
    expect(resolvePeriod("pesach", 2027)[0].startDate).not.toBe(resolvePeriod("pesach", 2026)[0].startDate);
  });
});

describe("matchPeriodKinds", () => {
  it("understands how owners actually phrase the request", () => {
    expect(matchPeriodKinds("אני רוצה שכל ערב חג יהיה יקר פי 2")).toEqual(["erev-chag"]);
    expect(matchPeriodKinds("בין הזמנים")).toEqual(["bein-hazmanim"]);
    expect(matchPeriodKinds("חול המועד סוכות מינימום 3 לילות")).toEqual(expect.arrayContaining(["chol-hamoed", "sukkot"]));
  });

  it("prefers the eve over the festival when the owner said 'ערב חג'", () => {
    expect(matchPeriodKinds("ערב חג")).not.toContain("chag");
  });

  it("returns nothing it isn't sure about, leaving the LLM fallback to try", () => {
    expect(matchPeriodKinds("בשבוע של הכנס בתל אביב")).toEqual([]);
  });
});

describe("isPeriodKind", () => {
  it("rejects anything outside the catalogue", () => {
    expect(isPeriodKind("erev-chag")).toBe(true);
    expect(isPeriodKind("whatever-the-model-made-up")).toBe(false);
    expect(isPeriodKind(null)).toBe(false);
  });
});
