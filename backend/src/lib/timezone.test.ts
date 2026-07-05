import { describe, it, expect } from "vitest";
import {
  zonedWallTimeToUtc,
  zonedDateParts,
  parseDateString,
  dayOfWeekForDate,
  instantPartsInTz,
  parseBookingTime,
} from "./timezone.js";

const TZ = "Asia/Jerusalem";

describe("zonedWallTimeToUtc", () => {
  it("converts summer (IDT, UTC+3) wall time to UTC", () => {
    // 2026-07-15 is in Israeli Daylight Time.
    const d = zonedWallTimeToUtc(2026, 7, 15, 9 * 60, TZ); // 09:00 local
    expect(d.toISOString()).toBe("2026-07-15T06:00:00.000Z");
  });

  it("converts winter (IST, UTC+2) wall time to UTC", () => {
    // 2026-01-15 is in Israeli Standard Time.
    const d = zonedWallTimeToUtc(2026, 1, 15, 9 * 60, TZ); // 09:00 local
    expect(d.toISOString()).toBe("2026-01-15T07:00:00.000Z");
  });

  it("round-trips midnight correctly", () => {
    const d = zonedWallTimeToUtc(2026, 3, 1, 0, TZ);
    const parts = zonedDateParts(d, TZ);
    expect(parts).toEqual({ year: 2026, month: 3, day: 1, dayOfWeek: 0 }); // 2026-03-01 is a Sunday
  });
});

describe("dayOfWeekForDate", () => {
  it("computes the correct weekday for a known date", () => {
    // July 9, 2026 is a Thursday — this exact date caused a real-world bug this session
    // where the bot mislabeled it "רביעי" (Wednesday) instead of "חמישי" (Thursday).
    expect(dayOfWeekForDate(2026, 7, 9)).toBe(4);
  });

  it("agrees with native Date for a spread of dates", () => {
    for (let day = 1; day <= 28; day++) {
      const expected = new Date(Date.UTC(2026, 0, day, 12)).getUTCDay();
      expect(dayOfWeekForDate(2026, 1, day)).toBe(expected);
    }
  });
});

describe("parseDateString", () => {
  it("parses YYYY-MM-DD without shifting", () => {
    expect(parseDateString("2026-07-09")).toEqual({ year: 2026, month: 7, day: 9 });
  });

  it("tolerates a full ISO timestamp by taking only the date part", () => {
    expect(parseDateString("2026-07-09T15:30:00.000Z")).toEqual({ year: 2026, month: 7, day: 9 });
  });
});

describe("instantPartsInTz", () => {
  it("extracts local weekday and minutes-from-midnight for a UTC instant", () => {
    // 06:00 UTC on 2026-07-15 is 09:00 local (summer, UTC+3) — a Wednesday.
    const parts = instantPartsInTz(new Date("2026-07-15T06:00:00.000Z"), TZ);
    expect(parts.minutes).toBe(9 * 60);
    expect(parts.dayOfWeek).toBe(3); // Wednesday
  });

  it("handles the day boundary correctly", () => {
    // 21:30 UTC on a summer evening is 00:30 local the next day.
    const parts = instantPartsInTz(new Date("2026-07-14T21:30:00.000Z"), TZ);
    expect(parts.minutes).toBe(30);
    expect(parts.dayOfWeek).toBe(3); // now Wednesday the 15th locally
  });
});

describe("parseBookingTime", () => {
  it("treats a Z-suffixed ISO string as an exact instant, ignoring the timezone arg", () => {
    const d = parseBookingTime("2026-07-15T08:00:00.000Z", TZ);
    expect(d.toISOString()).toBe("2026-07-15T08:00:00.000Z");
  });

  it("treats an offset-suffixed string as an exact instant", () => {
    const d = parseBookingTime("2026-07-15T11:00:00+03:00", TZ);
    expect(d.toISOString()).toBe("2026-07-15T08:00:00.000Z");
  });

  it("interprets a naive datetime (no zone) as local wall-clock time — this is the fix for the bug where the model fabricated '11:00' and it was stored as 11:00 UTC instead of 11:00 Israel time", () => {
    const d = parseBookingTime("2026-07-15T11:00:00", TZ);
    expect(d.toISOString()).toBe("2026-07-15T08:00:00.000Z"); // 11:00 IDT (UTC+3) = 08:00 UTC
  });

  it("interprets a naive datetime with a space separator", () => {
    const d = parseBookingTime("2026-01-15 09:00", TZ);
    expect(d.toISOString()).toBe("2026-01-15T07:00:00.000Z"); // 09:00 IST (UTC+2) = 07:00 UTC
  });
});
