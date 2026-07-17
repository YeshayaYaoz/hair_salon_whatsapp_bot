// Shared booking side-effects (calendar sync, waitlist notification, owner alerts) used by both
// the WhatsApp bot (claudeBot.ts) and the voice bot (voiceRoutes.ts), so cancel/reschedule/book
// behave identically regardless of which channel the customer used — one has a slot cancelled,
// the freed time offered to the waitlist, and the calendar cleaned up the same way either way.
import { prisma } from "../lib/prisma.js";
import type { Appointment } from "@prisma/client";
import { createAppointment, SlotUnavailableError, OutsideBusinessHoursError } from "./availability.js";
import { syncAppointmentToCalendar, deleteCalendarEvent } from "../lib/googleCalendar.js";
import { notifyWaitlist } from "../lib/waitlist.js";
import { notifyOwner } from "../lib/ownerNotify.js";

export { SlotUnavailableError, OutsideBusinessHoursError };

export class AppointmentNotFoundError extends Error {
  constructor() {
    super("No matching appointment found");
    this.name = "AppointmentNotFoundError";
  }
}

/** Creates an appointment and fires the same side effects a WhatsApp booking gets: owner alert + calendar sync. */
export async function bookAppointmentWithSideEffects(params: {
  businessId: string;
  serviceId: string;
  serviceName: string;
  customerPhone: string;
  customerName?: string;
  startTime: Date;
  staffId?: string | null;
  staffName?: string;
  ownerAlertPrefix: string; // e.g. "📅 הזמנה חדשה (וואטסאפ)" vs "📞 הזמנה חדשה (שיחה)"
}): Promise<Appointment> {
  const appointment = await createAppointment({
    businessId: params.businessId,
    serviceId: params.serviceId,
    customerPhone: params.customerPhone,
    customerName: params.customerName,
    startTime: params.startTime,
    staffId: params.staffId,
  });

  const customerLabel = params.customerName ?? params.customerPhone;
  const staffLine = params.staffName ? `\nעם: ${params.staffName}` : "";
  notifyOwner(
    params.businessId,
    `${params.ownerAlertPrefix}\nלקוח: ${customerLabel}\nשירות: ${params.serviceName}\nמועד: ${appointment.startTime.toLocaleString("he-IL")}${staffLine}`
  ).catch((err) => console.error("Owner notification failed:", err));

  syncAppointmentToCalendar(params.businessId, {
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    serviceName: params.serviceName,
    customerName: params.customerName,
    customerPhone: params.customerPhone,
  })
    .then((eventId) => {
      if (eventId) return prisma.appointment.update({ where: { id: appointment.id }, data: { calendarEventId: eventId } });
    })
    .catch((err) => console.error("Calendar sync failed:", err));

  return appointment;
}

/** Cancels an appointment by id, scoped to the business (never trust a bare id from an untrusted caller). */
export async function cancelAppointmentById(businessId: string, appointmentId: string): Promise<void> {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, businessId, status: "confirmed" },
    include: { service: true },
  });
  if (!appointment) throw new AppointmentNotFoundError();

  await prisma.appointment.update({ where: { id: appointment.id }, data: { status: "cancelled" } });
  if (appointment.calendarEventId) {
    deleteCalendarEvent(businessId, appointment.calendarEventId).catch((err) => console.error("Calendar event delete failed:", err));
  }
  notifyWaitlist(businessId, appointment.serviceId, appointment.service.name, appointment.startTime).catch((err) =>
    console.error("[waitlist] Notification failed:", err)
  );
}

/**
 * Reschedules an appointment by id to a new time (optionally a new service/staff). Cancels the old
 * slot first so it doesn't block the new one, then books the new time — and restores the original
 * on failure so the customer is never left with nothing.
 */
export async function rescheduleAppointmentById(params: {
  businessId: string;
  appointmentId: string;
  newStartTime: Date;
  newServiceId?: string;
  newStaffId?: string | null;
  ownerAlertPrefix: string;
}): Promise<Appointment> {
  const existing = await prisma.appointment.findFirst({
    where: { id: params.appointmentId, businessId: params.businessId, status: "confirmed" },
    include: { service: true, customer: true, staff: true },
  });
  if (!existing) throw new AppointmentNotFoundError();

  await prisma.appointment.update({ where: { id: existing.id }, data: { status: "cancelled" } });
  if (existing.calendarEventId) {
    deleteCalendarEvent(params.businessId, existing.calendarEventId).catch((err) => console.error("Calendar event delete failed:", err));
  }

  const serviceId = params.newServiceId ?? existing.serviceId;
  const service = params.newServiceId ? await prisma.service.findUniqueOrThrow({ where: { id: serviceId } }) : existing.service;
  const staffId = params.newStaffId !== undefined ? params.newStaffId : existing.staffId;

  try {
    return await bookAppointmentWithSideEffects({
      businessId: params.businessId,
      serviceId,
      serviceName: service.name,
      customerPhone: existing.customer.phone,
      customerName: existing.customer.name ?? undefined,
      startTime: params.newStartTime,
      staffId,
      staffName: staffId ? existing.staff?.name : undefined,
      ownerAlertPrefix: params.ownerAlertPrefix,
    });
  } catch (err) {
    // New slot was taken or invalid — restore the original so the customer isn't left with nothing.
    await prisma.appointment.update({ where: { id: existing.id }, data: { status: "confirmed" } });
    throw err;
  }
}
