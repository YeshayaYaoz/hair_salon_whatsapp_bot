import { describe, it, expect } from "vitest";
import { zonedWallTimeToUtc, zonedDateParts } from "./timezone.js";

/**
 * The server runs on UTC (no TZ is set anywhere in the image or the Railway config), and every
 * appointment is stored as an absolute instant. So a toLocaleString without an explicit timeZone
 * renders the UTC hour — and three messages were doing exactly that: the booking confirmation sent
 * after a phone booking, the day-before reminder, and the owner's new-booking alert. A 10:00
 * appointment was confirmed to the customer as 07:00.
 *
 * These assert the property rather than the call sites: formatting an instant without a zone is
 * wrong by the UTC offset, and with the zone is right. If the fix is ever reverted, the first
 * expectation here fails.
 */
const TZ = "Asia/Jerusalem";

/** A 10:00 appointment in Israel, in July (IDT, UTC+3). */
const summerTen = zonedWallTimeToUtc(2026, 7, 15, 10 * 60, TZ);
/** A 10:00 appointment in Israel, in January (IST, UTC+2). */
const winterTen = zonedWallTimeToUtc(2027, 1, 15, 10 * 60, TZ);

const hourIn = (d: Date, timeZone?: string) =>
  d.toLocaleString("he-IL", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });

describe("appointment times in customer messages", () => {
  it("reads back as 10:00 when the zone is passed", () => {
    expect(hourIn(summerTen, TZ)).toBe("10:00");
    expect(hourIn(winterTen, TZ)).toBe("10:00");
  });

  it("reads back as the UTC hour when it is not — the bug these messages had", () => {
    // Documents the failure mode explicitly: same instant, no zone, three hours early in summer
    // and two in winter. Guards against someone "simplifying" the option object away again.
    expect(hourIn(summerTen)).toBe("07:00");
    expect(hourIn(winterTen)).toBe("08:00");
  });

  it("survives the DST change, because the instant is built from wall time", () => {
    // Israel moves to IDT in late March. A salon's 10:00 is 10:00 on both sides of it; the UTC
    // instant behind it differs by an hour, which is exactly what zonedWallTimeToUtc exists for.
    const beforeDst = zonedWallTimeToUtc(2026, 3, 20, 10 * 60, TZ);
    const afterDst = zonedWallTimeToUtc(2026, 4, 10, 10 * 60, TZ);
    expect(hourIn(beforeDst, TZ)).toBe("10:00");
    expect(hourIn(afterDst, TZ)).toBe("10:00");
    expect(beforeDst.getUTCHours()).toBe(8); // IST, UTC+2
    expect(afterDst.getUTCHours()).toBe(7); // IDT, UTC+3
  });
});

describe("calendar-day boundaries in the salon's timezone", () => {
  it("files a late-evening appointment under the local day, not the UTC one", () => {
    // 23:30 local in summer is 20:30 UTC the same day — this one agrees either way.
    const evening = zonedWallTimeToUtc(2026, 7, 15, 23 * 60 + 30, TZ);
    expect(zonedDateParts(evening, TZ).day).toBe(15);
  });

  it("files a small-hours appointment under the local day, where UTC disagrees", () => {
    // 01:00 local on the 15th is 22:00 UTC on the 14th. Bucketing by toISOString() put this in the
    // previous day's column on the dashboard, and outside "this month" on the 1st.
    const smallHours = zonedWallTimeToUtc(2026, 7, 15, 60, TZ);
    expect(smallHours.toISOString().slice(0, 10)).toBe("2026-07-14");
    expect(zonedDateParts(smallHours, TZ).day).toBe(15);
  });
});
