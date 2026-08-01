import { describe, it, expect, vi } from "vitest";

vi.mock("./prisma.js", () => ({ prisma: {} }));

const { mapGoogleHours } = await import("./googleBusinessProfile.js");

describe("mapGoogleHours", () => {
  it("maps Google's day names and times to this app's minutes-from-midnight rows", () => {
    const { hours } = mapGoogleHours([
      { openDay: "SUNDAY", openTime: { hours: 9 }, closeDay: "SUNDAY", closeTime: { hours: 18, minutes: 30 } },
      { openDay: "MONDAY", openTime: { hours: 8, minutes: 15 }, closeDay: "MONDAY", closeTime: { hours: 17 } },
    ]);
    expect(hours).toEqual([
      { dayOfWeek: 0, openMin: 9 * 60, closeMin: 18 * 60 + 30 },
      { dayOfWeek: 1, openMin: 8 * 60 + 15, closeMin: 17 * 60 },
    ]);
  });

  it("treats an omitted hours field as midnight, which is how Google sends it", () => {
    const { hours } = mapGoogleHours([
      { openDay: "FRIDAY", openTime: { minutes: 30 }, closeDay: "FRIDAY", closeTime: { hours: 14 } },
    ]);
    expect(hours[0]).toEqual({ dayOfWeek: 5, openMin: 30, closeMin: 14 * 60 });
  });

  it("merges split hours into one span and reports which day was merged", () => {
    const { hours, mergedDays } = mapGoogleHours([
      { openDay: "TUESDAY", openTime: { hours: 9 }, closeDay: "TUESDAY", closeTime: { hours: 13 } },
      { openDay: "TUESDAY", openTime: { hours: 16 }, closeDay: "TUESDAY", closeTime: { hours: 20 } },
    ]);
    // This app stores one open/close pair per day, so the afternoon break can't be represented.
    expect(hours).toEqual([{ dayOfWeek: 2, openMin: 9 * 60, closeMin: 20 * 60 }]);
    expect(mergedDays).toEqual([2]);
  });

  it("skips overnight periods rather than importing a backwards range", () => {
    const { hours, skippedDays } = mapGoogleHours([
      { openDay: "FRIDAY", openTime: { hours: 20 }, closeDay: "SATURDAY", closeTime: { hours: 2 } },
    ]);
    expect(hours).toEqual([]);
    expect(skippedDays).toEqual([5]);
  });

  it("expands Google's 00:00-00:00 'open 24 hours' into a full day", () => {
    const { hours } = mapGoogleHours([
      { openDay: "WEDNESDAY", openTime: {}, closeDay: "WEDNESDAY", closeTime: {} },
    ]);
    expect(hours).toEqual([{ dayOfWeek: 3, openMin: 0, closeMin: 1440 }]);
  });

  it("ignores entries with an unrecognised or missing day", () => {
    expect(mapGoogleHours([{ openTime: { hours: 9 }, closeTime: { hours: 17 } }]).hours).toEqual([]);
    expect(mapGoogleHours([{ openDay: "FUNDAY", openTime: { hours: 9 }, closeTime: { hours: 17 } }]).hours).toEqual([]);
  });

  it("returns days in week order regardless of the order Google sent them", () => {
    const { hours } = mapGoogleHours([
      { openDay: "THURSDAY", openTime: { hours: 9 }, closeDay: "THURSDAY", closeTime: { hours: 17 } },
      { openDay: "SUNDAY", openTime: { hours: 9 }, closeDay: "SUNDAY", closeTime: { hours: 17 } },
    ]);
    expect(hours.map((h) => h.dayOfWeek)).toEqual([0, 4]);
  });

  it("handles an empty profile without throwing", () => {
    expect(mapGoogleHours([])).toEqual({ hours: [], mergedDays: [], skippedDays: [] });
  });
});
