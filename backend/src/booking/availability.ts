import type { StaffMember, Appointment } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { zonedWallTimeToUtc, parseDateString, dayOfWeekForDate, instantPartsInTz } from "../lib/timezone.js";

const SLOT_STEP_MIN = 30;

// A "pending_payment" hold (awaiting a deposit) blocks the slot exactly like a confirmed booking
// — otherwise two customers could be sent overlapping payment links for the same slot.
const SLOT_BLOCKING_STATUSES = ["confirmed", "pending_payment"];

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

    for (const staffId of staffOptions) {
      const conflict = dayAppointments.some(
        (a: Appointment) =>
          (staffId === null || a.staffId === staffId) &&
          slotStart < a.endTime &&
          slotEnd > a.startTime
      );
      if (!conflict) {
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

  // Guard against double-booking: reject if any confirmed appointment overlaps this window
  // (for the same staff member, or salon-wide when no staff is assigned).
  const overlap = await prisma.appointment.findFirst({
    where: {
      businessId: params.businessId,
      status: { in: SLOT_BLOCKING_STATUSES },
      ...(params.staffId ? { staffId: params.staffId } : {}),
      startTime: { lt: endTime },
      endTime: { gt: params.startTime },
    },
  });
  if (overlap) throw new SlotUnavailableError();

  return prisma.appointment.create({
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
