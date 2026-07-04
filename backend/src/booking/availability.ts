import type { StaffMember, Appointment } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const SLOT_STEP_MIN = 30;

export interface AvailableSlot {
  startTime: string; // ISO
  endTime: string;
  staffId: string | null;
}

/** Finds open slots for a service on a given calendar day, respecting business hours and existing appointments. */
export async function findAvailableSlots(
  businessId: string,
  serviceId: string,
  date: Date
): Promise<AvailableSlot[]> {
  const [service, hours, staff, dayAppointments] = await Promise.all([
    prisma.service.findUniqueOrThrow({ where: { id: serviceId } }),
    prisma.businessHours.findUnique({
      where: { businessId_dayOfWeek: { businessId, dayOfWeek: date.getDay() } },
    }),
    prisma.staffMember.findMany({ where: { businessId } }),
    prisma.appointment.findMany({
      where: {
        businessId,
        status: "confirmed",
        startTime: { gte: startOfDay(date), lt: endOfDay(date) },
      },
    }),
  ]);

  if (!hours) return [];

  const staffOptions: (string | null)[] = staff.length > 0 ? staff.map((s: StaffMember) => s.id) : [null];
  const slots: AvailableSlot[] = [];

  for (let startMin = hours.openMin; startMin + service.durationMin <= hours.closeMin; startMin += SLOT_STEP_MIN) {
    const slotStart = addMinutes(startOfDay(date), startMin);
    const slotEnd = addMinutes(slotStart, service.durationMin);
    if (slotStart < new Date()) continue;

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
}) {
  const service = await prisma.service.findUniqueOrThrow({ where: { id: params.serviceId } });
  const endTime = addMinutes(params.startTime, service.durationMin);

  const customer = await prisma.customer.upsert({
    where: { businessId_phone: { businessId: params.businessId, phone: params.customerPhone } },
    update: params.customerName ? { name: params.customerName } : {},
    create: { businessId: params.businessId, phone: params.customerPhone, name: params.customerName },
  });

  return prisma.appointment.create({
    data: {
      businessId: params.businessId,
      customerId: customer.id,
      serviceId: params.serviceId,
      staffId: params.staffId ?? null,
      startTime: params.startTime,
      endTime,
    },
  });
}

function startOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
function endOfDay(d: Date) {
  return addMinutes(startOfDay(d), 1440);
}
function addMinutes(d: Date, min: number) {
  return new Date(d.getTime() + min * 60_000);
}
