import { prisma } from "../lib/prisma.js";
import { decryptSecret } from "../lib/crypto.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";
import { captureError } from "../lib/errorMonitoring.js";

/**
 * What the owner can actually get done from their own WhatsApp thread.
 *
 * The tools in claudeBot are thin wrappers over these; the reasoning about time zones, overlaps and
 * what counts as "today" lives here where it can be tested without a model in the loop.
 *
 * Everything here assumes authorisation has ALREADY been settled by managerAuth against the phone
 * number Meta signed. Nothing in this file re-derives who is asking, and nothing in it may ever
 * accept a phone number as a way of saying who is asking.
 */

/** Start and end of a calendar day in the business's own zone, as UTC instants. */
export function dayBounds(dateIso: string, timezone: string): { start: Date; end: Date } {
  // Interpreted in the business's zone rather than the server's: a salon in Jerusalem asking for
  // "today" at 00:30 UTC means the day that is currently running there, not yesterday.
  const local = new Date(`${dateIso}T00:00:00`);
  const asUtc = new Date(local.toLocaleString("en-US", { timeZone: "UTC" }));
  const asLocal = new Date(local.toLocaleString("en-US", { timeZone: timezone }));
  const offsetMs = asUtc.getTime() - asLocal.getTime();
  const start = new Date(local.getTime() + offsetMs);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** Today's date in the business's zone, as YYYY-MM-DD. */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

export interface ScheduleEntry {
  time: string;
  customer: string;
  phone: string;
  service: string;
  staff: string | null;
  status: string;
  appointmentId: string;
}

/**
 * The day's bookings, in the order they happen.
 *
 * Includes holds awaiting a deposit as well as confirmed bookings — an owner planning their day
 * needs to know a slot is spoken for even if the money has not landed, and a schedule that hid
 * them would show free time that is not free.
 */
export async function daySchedule(
  businessId: string,
  dateIso: string,
  timezone: string
): Promise<ScheduleEntry[]> {
  const { start, end } = dayBounds(dateIso, timezone);
  const appointments = await prisma.appointment.findMany({
    where: {
      businessId,
      startTime: { gte: start, lt: end },
      status: { in: ["confirmed", "pending_payment"] },
    },
    include: { customer: true, service: true, staff: true },
    orderBy: { startTime: "asc" },
  });

  return appointments.map((a) => ({
    time: new Intl.DateTimeFormat("he-IL", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(a.startTime),
    customer: a.customer.name ?? a.customer.phone,
    phone: a.customer.phone,
    service: a.service.name,
    staff: a.staff?.name ?? null,
    status: a.status,
    appointmentId: a.id,
  }));
}

export interface BusinessSummary {
  confirmedThisMonth: number;
  revenueThisMonthIls: number;
  newCustomersThisMonth: number;
  upcomingCount: number;
}

/** Headline numbers for "how are we doing" — the same figures the dashboard shows. */
export async function businessSummary(businessId: string, timezone: string): Promise<BusinessSummary> {
  const today = todayIn(timezone);
  const monthStart = dayBounds(`${today.slice(0, 7)}-01`, timezone).start;
  const now = new Date();

  const [confirmed, newCustomers, upcoming] = await Promise.all([
    prisma.appointment.findMany({
      where: { businessId, status: "confirmed", startTime: { gte: monthStart } },
      include: { service: true },
    }),
    prisma.customer.count({ where: { businessId, appointments: { some: { createdAt: { gte: monthStart } } } } }),
    prisma.appointment.count({ where: { businessId, status: "confirmed", startTime: { gte: now } } }),
  ]);

  // Revenue net of any coupon actually applied — quoting list prices would overstate takings for
  // exactly the businesses running promotions.
  const revenueAgorot = confirmed.reduce(
    (sum, a) => sum + Math.max(0, a.service.priceCents - (a.couponDiscountIls ?? 0) * 100),
    0
  );

  return {
    confirmedThisMonth: confirmed.length,
    revenueThisMonthIls: Math.round(revenueAgorot / 100),
    newCustomersThisMonth: newCustomers,
    upcomingCount: upcoming,
  };
}

export class BlockOverlapError extends Error {
  constructor(readonly conflicts: { time: string; customer: string; service: string }[]) {
    super("There are bookings inside that window.");
    this.name = "BlockOverlapError";
  }
}

/**
 * Blocks a window so the bot stops offering it — a dentist appointment, a supplier visit, a day off.
 *
 * Refuses when real bookings already sit inside it, listing them. Blocking over a booked slot does
 * not cancel anything, so the appointment would survive invisibly: the owner would believe the time
 * was theirs and the customer would arrive. Naming the clash makes the owner decide, which is the
 * only correct place for that decision.
 */
export async function blockTime(params: {
  businessId: string;
  start: Date;
  end: Date;
  reason?: string;
  timezone: string;
  /** Checks for clashes and writes nothing — lets the caller confirm against a window it knows is free. */
  dryRun?: boolean;
}): Promise<{ id: string | null }> {
  const { businessId, start, end, reason, timezone } = params;

  const clashing = await prisma.appointment.findMany({
    where: {
      businessId,
      status: { in: ["confirmed", "pending_payment"] },
      startTime: { lt: end },
      endTime: { gt: start },
    },
    include: { customer: true, service: true },
    orderBy: { startTime: "asc" },
  });

  if (clashing.length > 0) {
    throw new BlockOverlapError(
      clashing.map((a) => ({
        time: new Intl.DateTimeFormat("he-IL", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(a.startTime),
        customer: a.customer.name ?? a.customer.phone,
        service: a.service.name,
      }))
    );
  }

  if (params.dryRun) return { id: null };

  const created = await prisma.blockedTime.create({
    data: { businessId, startTime: start, endTime: end, reason: reason ?? null },
  });
  return { id: created.id };
}

/**
 * Tells a customer their booking was cancelled by the business.
 *
 * Best-effort and never allowed to fail the cancellation itself: the slot is genuinely free either
 * way, and a message that could not be delivered is reported to the owner rather than pretended
 * away — they are the only one who can pick up the phone instead.
 */
export async function notifyCustomerOfCancellation(params: {
  businessId: string;
  customerPhone: string;
  serviceName: string;
  when: string;
}): Promise<boolean> {
  const business = await prisma.business.findUnique({
    where: { id: params.businessId },
    select: { name: true, whatsappPhoneNumberId: true, whatsappAccessToken: true },
  });
  if (!business?.whatsappPhoneNumberId || !business.whatsappAccessToken) return false;

  try {
    await sendWhatsAppMessage({
      phoneNumberId: business.whatsappPhoneNumberId,
      accessToken: decryptSecret(business.whatsappAccessToken),
      to: params.customerPhone,
      text: `היי, התור שלך ל${params.serviceName} ב${params.when} בוטל על ידי ${business.name}. מצטערים על אי הנוחות! אפשר לכתוב לי כאן ונקבע מועד אחר 😊`,
    });
    return true;
  } catch (err) {
    console.error("[managerActions] Could not tell the customer their booking was cancelled:", err);
    captureError(err, { businessId: params.businessId, phase: "owner_cancellation_notice" });
    return false;
  }
}
