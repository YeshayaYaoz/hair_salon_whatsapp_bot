import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../lib/depositExpiryJob.js", () => ({ noteDepositHoldCreated: vi.fn() }));

import { slotHasRoom } from "./availability.js";

const unassigned = { staffId: null };
const withStaff = (id: string) => ({ staffId: id });

/**
 * The bug: a customer was told 10:00 was already taken and offered 10:00 in the same message.
 *
 * Availability matched conflicts on `a.staffId === thisStaffId` while iterating real staff, so an
 * appointment with no staff assigned — the normal case, since customers rarely name a stylist —
 * matched nobody and blocked nothing. Booking, given no staff preference, dropped the staff filter
 * and treated any overlap as a clash. One rule overbooked, the other refused valid bookings.
 */
describe("slotHasRoom", () => {
  describe("a business with no staff configured", () => {
    it("has room when nothing overlaps", () => {
      expect(slotHasRoom({ overlapping: [], staffCount: 0 })).toBe(true);
    });

    it("is full after one booking — it is a single resource", () => {
      expect(slotHasRoom({ overlapping: [unassigned], staffCount: 0 })).toBe(false);
    });
  });

  describe("unassigned bookings", () => {
    it("blocks the shop once every chair is spoken for", () => {
      // The overbooking half of the bug: two unassigned bookings at a two-chair salon fills it.
      expect(slotHasRoom({ overlapping: [unassigned, unassigned], staffCount: 2 })).toBe(false);
    });

    it("still leaves room at a salon with more chairs than bookings", () => {
      // The other half: one booking must not close a three-chair salon.
      expect(slotHasRoom({ overlapping: [unassigned], staffCount: 3 })).toBe(true);
    });

    it("counts alongside assigned ones", () => {
      expect(slotHasRoom({ overlapping: [withStaff("a"), unassigned], staffCount: 2 })).toBe(false);
      expect(slotHasRoom({ overlapping: [withStaff("a"), unassigned], staffCount: 3 })).toBe(true);
    });
  });

  describe("when the customer asked for a specific person", () => {
    it("refuses when that person is booked, even with other chairs free", () => {
      expect(
        slotHasRoom({ overlapping: [withStaff("dana")], staffCount: 3, requestedStaffId: "dana" })
      ).toBe(false);
    });

    it("allows it when someone else is the one who is busy", () => {
      expect(
        slotHasRoom({ overlapping: [withStaff("yossi")], staffCount: 3, requestedStaffId: "dana" })
      ).toBe(true);
    });

    it("refuses when the unassigned bookings have nowhere else to go", () => {
      // Two chairs, one unassigned booking, and Dana is asked for: the unassigned booking can only
      // be Dana or the other chair. Granting Dana here would overbook the shop as a whole.
      expect(
        slotHasRoom({ overlapping: [withStaff("yossi"), unassigned], staffCount: 2, requestedStaffId: "dana" })
      ).toBe(false);
    });

    it("allows it when the unassigned bookings fit elsewhere", () => {
      expect(
        slotHasRoom({ overlapping: [unassigned], staffCount: 3, requestedStaffId: "dana" })
      ).toBe(true);
    });
  });

  it("never treats a staffCount of 0 as zero capacity", () => {
    // Guarding the arithmetic itself: resources floors at 1, so an unstaffed business can book.
    expect(slotHasRoom({ overlapping: [], staffCount: 0 })).toBe(true);
  });
});
