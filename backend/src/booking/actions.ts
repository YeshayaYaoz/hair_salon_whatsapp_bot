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
import { decryptSecret } from "../lib/crypto.js";
import { sendWithTemplateFallback } from "../lib/scheduledMessages.js";
import { confirmationTemplate } from "../lib/whatsappTemplates.js";
import { releaseCustomerCoupon } from "./customerCoupons.js";

export { SlotUnavailableError, OutsideBusinessHoursError };

/**
 * Sends the customer their booking in writing.
 *
 * Written for phone bookings, where nothing else does. The voice agent reads the time back and the
 * call ends; the caller is left holding a time they heard once, for a business whose address they
 * were told out loud. On the live calls that prompted this, callers asked to be sent details
 * precisely because a spoken time is not something anyone trusts themselves to remember.
 *
 * A caller who has never messaged this business has no open 24h window, so this almost always goes
 * out as a template — which is the whole reason a confirmation template has to exist rather than
 * being an optional nicety.
 */
async function confirmBookingToCustomer(params: {
  businessId: string;
  customerPhone: string;
  customerName?: string;
  serviceName: string;
  startTime: Date;
}): Promise<void> {
  const business = await prisma.business.findUnique({
    where: { id: params.businessId },
    select: { name: true, address: true, timezone: true, whatsappPhoneNumberId: true, whatsappAccessToken: true },
  });
  if (!business?.whatsappPhoneNumberId || !business.whatsappAccessToken) return;

  // The same localized string the reminder uses, so a customer sees one format across both messages
  // rather than two renderings of the same appointment.
  //
  // timeZone is not optional: startTime is an absolute UTC instant and the server runs on UTC, so
  // without it a 10:00 appointment was confirmed to the customer as 07:00.
  const when = params.startTime.toLocaleString("he-IL", {
    timeZone: business.timezone || "Asia/Jerusalem",
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
  const name = params.customerName ? params.customerName.split(" ")[0] : "היי";
  const addressLine = business.address ? `\n📍 ${business.address}` : "";
  const text = `${name}! 👋 התור שלך ל${params.serviceName} נקבע ל-${when} אצל ${business.name}.${addressLine}\n\nלביטול יש לכתוב "בטל תור".`;

  const outcome = await sendWithTemplateFallback(
    params.businessId,
    {
      phoneNumberId: business.whatsappPhoneNumberId,
      accessToken: decryptSecret(business.whatsappAccessToken),
      to: params.customerPhone,
      },
    text,
    confirmationTemplate(),
    [name, params.serviceName, when, business.name]
  );
  if (outcome === "sent") console.log(`[booking] Confirmation sent to ${params.customerPhone}`);
  else console.warn(`[booking] Confirmation undelivered — caller has no open window and ${confirmationTemplate().name} is not approved on this WABA`);
}

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
  /**
   * Which channel the booking came in on.
   *
   * Only "voice" gets a written confirmation. A WhatsApp booking is already confirmed by the bot's
   * own reply in the same thread, and a second message repeating it reads as a duplicate. A phone
   * booking has no thread at all — which is the gap this exists to close.
   *
   * Defaults to "whatsapp" so an unconverted caller keeps today's behaviour rather than silently
   * starting to message customers.
   */
  source?: "whatsapp" | "voice";
}): Promise<Appointment> {
  const appointment = await createAppointment({
    businessId: params.businessId,
    serviceId: params.serviceId,
    customerPhone: params.customerPhone,
    customerName: params.customerName,
    startTime: params.startTime,
    staffId: params.staffId,
  });

  if (params.source === "voice") {
    // Fire-and-forget: the appointment is already booked, and a caller who has hung up must never
    // have the booking fail because a confirmation could not be delivered.
    confirmBookingToCustomer({
      businessId: params.businessId,
      customerPhone: params.customerPhone,
      customerName: params.customerName,
      serviceName: params.serviceName,
      startTime: appointment.startTime,
    }).catch((err) => console.error("[booking] Customer confirmation failed (non-fatal):", err));
  }

  const customerLabel = params.customerName ?? params.customerPhone;
  const staffLine = params.staffName ? `\nעם: ${params.staffName}` : "";
  // Same reason as the customer confirmation above: without timeZone the owner was alerted to a
  // booking at the UTC hour, so every alert named a time two or three hours before the real one.
  const tz = (await prisma.business.findUnique({
    where: { id: params.businessId },
    select: { timezone: true },
  }))?.timezone || "Asia/Jerusalem";
  const whenForOwner = appointment.startTime.toLocaleString("he-IL", {
    timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
  notifyOwner(
    params.businessId,
    `${params.ownerAlertPrefix}\nלקוח: ${customerLabel}\nשירות: ${params.serviceName}\nמועד: ${whenForOwner}${staffLine}`
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
  // Gives the coupon use back. Without it a limited promotion drains on bookings that never
  // happened, and a "new client" code is spent forever by a customer who cancelled.
  await releaseCustomerCoupon(appointment.id);
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
  /** Passed straight through — a phone reschedule leaves the customer with nothing in writing for
   * exactly the same reason a phone booking does, and the new time is the one that matters. */
  source?: "whatsapp" | "voice";
}): Promise<Appointment> {
  const existing = await prisma.appointment.findFirst({
    where: { id: params.appointmentId, businessId: params.businessId, status: "confirmed" },
    include: { service: true, customer: true, staff: true },
  });
  if (!existing) throw new AppointmentNotFoundError();

  await prisma.appointment.update({ where: { id: existing.id }, data: { status: "cancelled" } });
  await releaseCustomerCoupon(existing.id);
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
      source: params.source,
    });
  } catch (err) {
    // New slot was taken or invalid — restore the original so the customer isn't left with nothing.
    await prisma.appointment.update({ where: { id: existing.id }, data: { status: "confirmed" } });
    throw err;
  }
}
