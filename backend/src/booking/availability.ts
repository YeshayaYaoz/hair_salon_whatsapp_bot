import type { StaffMember, Appointment } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { zonedWallTimeToUtc, parseDateString, dayOfWeekForDate, instantPartsInTz } from "../lib/timezone.js";
import { noteDepositHoldCreated } from "../lib/depositExpiryJob.js";

const SLOT_STEP_MIN = 30;

// A "pending_payment" hold (awaiting a deposit) blocks the slot exactly like a confirmed booking
// — otherwise two customers could be sent overlapping payment links for the same slot. Exported
// so anything else that needs to know "is this slot actually occupied" (e.g. the empty-slot yield
// campaign scan) stays consistent with availability rather than re-deriving its own status list.
export const SLOT_BLOCKING_STATUSES = ["confirmed", "pending_payment"];

/**
 * Whether a slot still has room, given everything already booked over it.
 *
 * This exists because availability and booking used to answer that question with two different
 * rules, and they contradicted each other in both directions — visibly, in one WhatsApp message
 * that told a customer 10:00 was taken and then offered them 10:00.
 *
 * The cause was appointments with no staff assigned (the normal case: the customer didn't ask for
 * anyone). Availability iterated over real staff ids and matched conflicts on `a.staffId === id`,
 * so an unassigned appointment matched nobody and blocked nothing — two customers could be booked
 * into the same chair. Booking, given no staff preference, dropped the staff filter entirely and
 * treated ANY overlap as a clash — so at a three-chair salon one booking closed the slot for
 * everyone.
 *
 * The rule both now share: a slot holds as many appointments as there are staff. An assigned
 * appointment occupies that specific person; an unassigned one occupies some unnamed free person.
 * A business with no staff configured has exactly one resource, which is the old behaviour.
 */
export function slotHasRoom(params: {
  /** Appointments already overlapping this slot — callers filter by time before calling. */
  overlapping: { staffId: string | null }[];
  /** How many staff can serve this slot. 0 is treated as 1: an unstaffed business is one resource. */
  staffCount: number;
  /** Set when the customer asked for a specific person; that exact person must be free. */
  requestedStaffId?: string | null;
}): boolean {
  const resources = Math.max(1, params.staffCount);
  const busyStaff = new Set<string>();
  let unassigned = 0;
  for (const a of params.overlapping) {
    if (a.staffId) busyStaff.add(a.staffId);
    else unassigned += 1;
  }

  if (params.requestedStaffId) {
    if (busyStaff.has(params.requestedStaffId)) return false;
    // The unassigned bookings still have to fit somewhere, and it cannot be this person — so they
    // need room among the others. Without this, asking for a specific stylist could overbook the
    // shop as a whole.
    return unassigned <= resources - busyStaff.size - 1;
  }

  return busyStaff.size + unassigned < resources;
}

export interface AvailableSlot {
  startTime: string; // ISO (UTC)
  endTime: string;
  staffId: string | null;
}

export class SlotUnavailableError extends Error {
  constructor() {
    super("Slot no longer available");
    this.name = "SlotUnavailableError";
  }
}

/** Thrown when a requested time falls outside the business's open hours for that day. */
export class OutsideBusinessHoursError extends Error {
  constructor(message = "Requested time is outside business hours") {
    super(message);
    this.name = "OutsideBusinessHoursError";
  }
}

/** Finds open slots for a service on a given calendar day, respecting business hours (in the business timezone) and existing appointments. */
export async function findAvailableSlots(
  businessId: string,
  serviceId: string,
  date: Date | string,
  overrideDurationMin?: number,
  preferredStaffId?: string
): Promise<AvailableSlot[]> {
  const dateStr = typeof date === "string" ? date : date.toISOString();
  const { year, month, day } = parseDateString(dateStr);
  const dayOfWeek = dayOfWeekForDate(year, month, day);

  const [business, service, hours, staff] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } }),
    prisma.service.findUniqueOrThrow({ where: { id: serviceId } }),
    prisma.businessHours.findUnique({ where: { businessId_dayOfWeek: { businessId, dayOfWeek } } }),
    prisma.staffMember.findMany({ where: { businessId } }),
  ]);

  if (!hours) return [];

  const tz = business.timezone || "Asia/Jerusalem";
  const dayStartUtc = zonedWallTimeToUtc(year, month, day, 0, tz);
  const dayEndUtc = zonedWallTimeToUtc(year, month, day, 24 * 60, tz);

  const [dayAppointments, dayBlocks] = await Promise.all([
    prisma.appointment.findMany({
      where: { businessId, status: { in: SLOT_BLOCKING_STATUSES }, startTime: { gte: dayStartUtc, lt: dayEndUtc } },
    }),
    prisma.blockedTime.findMany({
      where: { businessId, startTime: { lt: dayEndUtc }, endTime: { gt: dayStartUtc } },
    }),
  ]);

  const durationMin = overrideDurationMin ?? service.durationMin;
  const capacity = service.capacity ?? 1;
  // If the customer asked for a specific staff member, only offer times that person is free —
  // don't silently substitute someone else. Otherwise any staff member (or unassigned) will do.
  const staffOptions: (string | null)[] = preferredStaffId
    ? [preferredStaffId]
    : staff.length > 0
      ? staff.map((s: StaffMember) => s.id)
      : [null];
  const slots: AvailableSlot[] = [];
  const now = new Date();

  for (let startMin = hours.openMin; startMin + durationMin <= hours.closeMin; startMin += SLOT_STEP_MIN) {
    const slotStart = zonedWallTimeToUtc(year, month, day, startMin, tz);
    const slotEnd = new Date(slotStart.getTime() + durationMin * 60_000);
    if (slotStart < now) continue;
    // Skip slots that overlap an owner-defined closure (vacation, break, holiday).
    if (dayBlocks.some((b) => slotStart < b.endTime && slotEnd > b.startTime)) continue;

    if (capacity > 1) {
      // Group class: the slot holds up to `capacity` attendees of THIS service. Staff identity
      // doesn't gate a class (one instructor runs it), so we count how many are already booked
      // into this service's slot and offer it until it's full.
      const booked = dayAppointments.filter(
        (a: Appointment) => a.serviceId === serviceId && slotStart < a.endTime && slotEnd > a.startTime
      ).length;
      if (booked < capacity) {
        slots.push({ startTime: slotStart.toISOString(), endTime: slotEnd.toISOString(), staffId: preferredStaffId ?? null });
      }
      continue;
    }

    // 1:1 appointment (every existing service): offer the slot if the shop still has room for it,
    // counting unassigned bookings as occupying someone — see slotHasRoom.
    const overlapping = dayAppointments.filter(
      (a: Appointment) => slotStart < a.endTime && slotEnd > a.startTime
    );
    for (const staffId of staffOptions) {
      if (slotHasRoom({ overlapping, staffCount: staff.length, requestedStaffId: preferredStaffId ? staffId : null })) {
        slots.push({ startTime: slotStart.toISOString(), endTime: slotEnd.toISOString(), staffId });
        break; // one slot per start time is enough to offer
      }
    }
  }

  return slots;
}

export async function createAppointment(params: {
  businessId: string;
  serviceId: string;
  customerPhone: string;
  customerName?: string;
  startTime: Date;
  staffId?: string | null;
  overrideDurationMin?: number;
  // Deposit-hold fields — set together when creating a "pending_payment" hold instead of an
  // outright confirmed booking. The payment link itself is generated afterward (it needs this
  // appointment's own id as its reference) and attached with attachDepositPaymentLink below.
  status?: "confirmed" | "pending_payment";
  depositAmountIls?: number;
  depositExpiresAt?: Date;
}) {
  const service = await prisma.service.findUniqueOrThrow({ where: { id: params.serviceId } });
  const durationMin = params.overrideDurationMin ?? service.durationMin;
  const endTime = new Date(params.startTime.getTime() + durationMin * 60_000);

  // Reject bookings outside the business's open hours — the bot must not be able to book past
  // closing time (or on a closed day) even if it sends a bad time.
  const business = await prisma.business.findUniqueOrThrow({ where: { id: params.businessId }, select: { timezone: true } });
  const tz = business.timezone || "Asia/Jerusalem";
  const { dayOfWeek, minutes: startMin } = instantPartsInTz(params.startTime, tz);
  const hours = await prisma.businessHours.findUnique({
    where: { businessId_dayOfWeek: { businessId: params.businessId, dayOfWeek } },
  });
  if (!hours || startMin < hours.openMin || startMin + durationMin > hours.closeMin) {
    throw new OutsideBusinessHoursError();
  }

  // Also reject times inside an owner-defined closure (vacation, break, holiday).
  const blocked = await prisma.blockedTime.findFirst({
    where: { businessId: params.businessId, startTime: { lt: endTime }, endTime: { gt: params.startTime } },
  });
  if (blocked) throw new OutsideBusinessHoursError("Requested time falls within a blocked period (closure/vacation)");

  const customer = await prisma.customer.upsert({
    where: { businessId_phone: { businessId: params.businessId, phone: params.customerPhone } },
    update: params.customerName ? { name: params.customerName } : {},
    create: { businessId: params.businessId, phone: params.customerPhone, name: params.customerName },
  });

  const capacity = service.capacity ?? 1;
  if (capacity > 1) {
    // Group class: allow up to `capacity` attendees in the same slot of this service; reject once full.
    const booked = await prisma.appointment.count({
      where: {
        businessId: params.businessId,
        serviceId: params.serviceId,
        status: { in: SLOT_BLOCKING_STATUSES },
        startTime: { lt: endTime },
        endTime: { gt: params.startTime },
      },
    });
    if (booked >= capacity) throw new SlotUnavailableError();
  } else {
    // 1:1 appointment: the same room check availability uses, so the two cannot disagree again.
    const [overlapping, staffCount] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          businessId: params.businessId,
          status: { in: SLOT_BLOCKING_STATUSES },
          startTime: { lt: endTime },
          endTime: { gt: params.startTime },
        },
        select: { staffId: true },
      }),
      prisma.staffMember.count({ where: { businessId: params.businessId } }),
    ]);
    if (!slotHasRoom({ overlapping, staffCount, requestedStaffId: params.staffId })) {
      throw new SlotUnavailableError();
    }
  }

  const appointment = await prisma.appointment.create({
    data: {
      businessId: params.businessId,
      customerId: customer.id,
      serviceId: params.serviceId,
      staffId: params.staffId ?? null,
      startTime: params.startTime,
      endTime,
      ...(params.status ? { status: params.status } : {}),
      ...(params.depositAmountIls !== undefined ? { depositAmountIls: params.depositAmountIls, depositStatus: "pending" } : {}),
      ...(params.depositExpiresAt ? { depositExpiresAt: params.depositExpiresAt } : {}),
    },
  });

  // Tell the expiry job when to wake, so it can skip the database on every other tick — see the
  // nextExpiryAt comment in depositExpiryJob.ts for why that matters on usage-billed Postgres.
  if (params.depositExpiresAt) noteDepositHoldCreated(params.depositExpiresAt);

  return appointment;
}

/** Attaches the generated payment link to a pending-deposit appointment, once we have it. */
export async function attachDepositPaymentLink(
  appointmentId: string,
  params: { provider: string; paymentUrl: string; providerRef: string }
) {
  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { depositProvider: params.provider, depositPaymentUrl: params.paymentUrl, depositProviderRef: params.providerRef },
  });
}
