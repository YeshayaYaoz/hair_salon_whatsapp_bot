import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { findAvailableSlots, SlotUnavailableError, OutsideBusinessHoursError } from "../booking/availability.js";
import { bookAppointmentWithSideEffects, cancelAppointmentById, rescheduleAppointmentById, AppointmentNotFoundError } from "../booking/actions.js";
import { parseBookingTime, instantPartsInTz } from "../lib/timezone.js";
import { TEMPLATES, isBusinessType } from "../lib/businessTemplates.js";

export const voiceRouter = Router();

// Cartesia's agent hits these as custom tools during a live call, so it's a single shared secret
// configured once in the Cartesia agent's tool auth header — not a per-business webhook secret like
// the payment webhooks, since Cartesia isn't relaying anything a customer could see or forge a
// request from.
function requireCartesiaAuth(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  const secret = process.env.CARTESIA_TOOL_SECRET;
  const header = req.headers.authorization;
  if (!secret || header !== `Bearer ${secret}`) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// Digits only, so "+972501234567", "972501234567", and "0501234567"-with-country-code all compare
// the same way Customer.phone is stored (see whatsappRoutes.ts — stored verbatim as WhatsApp's
// `message.from`, which is already digits-only with country code, no leading "+").
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** Resolves which salon a call belongs to from the dialed number — every voice tool needs this first. */
async function resolveBusinessByCalledNumber(calledNumber: string): Promise<{ id: string; timezone: string; bookingModel: string } | null> {
  const calledDigits = normalizePhone(calledNumber);
  // Prisma can't filter on a normalized expression without raw SQL, and voicePhoneNumber may be
  // stored with or without a leading "+" depending on how it was entered — fetch the (expected to
  // stay small) set of voice-enabled businesses and match on digits in memory instead.
  const candidates = await prisma.business.findMany({
    where: { voicePhoneNumber: { not: null } },
    select: { id: true, voicePhoneNumber: true, timezone: true, bookingModel: true },
  });
  const matched = candidates.find((b) => normalizePhone(b.voicePhoneNumber!) === calledDigits);
  return matched ? { id: matched.id, timezone: matched.timezone, bookingModel: matched.bookingModel } : null;
}

// Inquiry-mode businesses (B&B etc.) close bookings only human-to-human — the voice agent briefs
// the caller and transfers to the owner. Guard server-side too, so a misfiring agent can never
// write a booking for them.
function rejectIfInquiry(business: { bookingModel: string }, res: import("express").Response): boolean {
  if (business.bookingModel !== "inquiry") return false;
  res.status(409).json({
    error: "This business does not take automated bookings. Brief the caller on prices and options, then transfer the call to the owner (ownerTransferNumber from /context).",
  });
  return true;
}

voiceRouter.use(requireCartesiaAuth);

// Called once per incoming call, before the agent speaks — resolves which salon the dialed number
// belongs to, and whether the caller is an existing customer with an upcoming appointment, so the
// agent can open with something like "Hi Dana, calling about your appointment tomorrow?" instead of
// a blind generic greeting.
voiceRouter.post("/context", async (req, res) => {
  const parsed = z.object({ calledNumber: z.string().min(1), callerNumber: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "calledNumber and callerNumber are required" });

  const business = await resolveBusinessByCalledNumber(parsed.data.calledNumber);
  if (!business) return res.status(404).json({ error: "No salon configured for this number" });

  const callerDigits = normalizePhone(parsed.data.callerNumber);
  // Midnight UTC today: SpecialPeriod.startDate/endDate are DATE columns, so comparing against a
  // timestamp with a time component would drop a period on the day it ends.
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [full, hours, customers, services, faqEntries, specialPeriods] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: business.id },
      select: {
        name: true, timezone: true, address: true, botGreeting: true, botPersonality: true,
        cancellationPolicy: true, businessType: true, bookingModel: true, availabilityInfo: true, notificationPhone: true,
      },
    }),
    prisma.businessHours.findMany({ where: { businessId: business.id }, orderBy: { dayOfWeek: "asc" } }),
    prisma.customer.findMany({ where: { businessId: business.id }, select: { id: true, phone: true, name: true } }),
    prisma.service.findMany({ where: { businessId: business.id }, select: { name: true, description: true, priceCents: true, durationMin: true } }),
    prisma.faqEntry.findMany({ where: { businessId: business.id }, select: { question: true, answer: true } }),
    // Dates on which the terms differ (holiday pricing, minimum stays). Without these the voice
    // agent quotes the ordinary rate on erev Pesach while the WhatsApp bot says it's different —
    // the two channels answer the same caller, so they must not disagree. Only periods that
    // haven't ended yet; past ones are noise that accumulates year over year.
    prisma.specialPeriod.findMany({
      where: { businessId: business.id, endDate: { gte: todayUtc } },
      orderBy: { startDate: "asc" },
      take: 40,
      select: { label: true, description: true, startDate: true, endDate: true },
    }),
  ]);
  const caller = customers.find((c) => normalizePhone(c.phone) === callerDigits);

  let upcomingAppointment: { id: string; serviceName: string; startTime: Date; staffName: string | null } | null = null;
  if (caller) {
    const appt = await prisma.appointment.findFirst({
      where: { businessId: business.id, customerId: caller.id, status: "confirmed", startTime: { gte: new Date() } },
      orderBy: { startTime: "asc" },
      include: { service: { select: { name: true } }, staff: { select: { name: true } } },
    });
    if (appt) upcomingAppointment = { id: appt.id, serviceName: appt.service.name, startTime: appt.startTime, staffName: appt.staff?.name ?? null };
  }

  // businessType drives the vocabulary the agent should speak in (e.g. call the customer "מטופל"
  // at a clinic vs "לקוח" at a salon) — same TEMPLATES source of truth the WhatsApp bot's prompt
  // reads from, so the two channels never disagree on what kind of business this is.
  const template = isBusinessType(full.businessType) ? TEMPLATES[full.businessType] : null;

  res.json({
    businessName: full.name,
    businessType: template ? { key: template.type, labelHe: template.labelHe, labelEn: template.labelEn } : null,
    vocabulary: template?.vocabulary ?? null,
    // "slot" = the agent may book live via check-availability/book. "inquiry" (B&B etc.) = the
    // agent must NOT book: it briefs the caller on prices/options/availabilityInfo and then
    // transfers the call to ownerTransferNumber — bookings close only human-to-human.
    bookingModel: full.bookingModel,
    availabilityInfo: full.availabilityInfo,
    ownerTransferNumber: full.bookingModel === "inquiry" ? full.notificationPhone : null,
    timezone: full.timezone,
    address: full.address,
    greeting: full.botGreeting,
    personality: full.botPersonality,
    cancellationPolicy: full.cancellationPolicy,
    // Date-only strings: the agent reads these out loud and compares them to what the caller asks
    // for, so a timezone-bearing timestamp would be both wrong to speak and easy to misread.
    specialPeriods: specialPeriods.map((p) => ({
      label: p.label,
      description: p.description,
      startDate: p.startDate.toISOString().slice(0, 10),
      endDate: p.endDate.toISOString().slice(0, 10),
    })),
    hours: hours.map((h) => ({ dayOfWeek: h.dayOfWeek, openMin: h.openMin, closeMin: h.closeMin })),
    services: services.map((s) => ({ name: s.name, description: s.description, priceIls: s.priceCents / 100, durationMin: s.durationMin })),
    faq: faqEntries,
    caller: caller
      ? { isKnownCustomer: true, name: caller.name, upcomingAppointment }
      : { isKnownCustomer: false, name: null, upcomingAppointment: null },
  });
});

function formatLocalTime(date: Date, timezone: string): string {
  const { minutes } = instantPartsInTz(date, timezone);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

// Finds open slots for a service on a given day — same underlying logic as the WhatsApp bot's
// check_availability tool (booking/availability.ts), so results never diverge between channels.
voiceRouter.post("/check-availability", async (req, res) => {
  const parsed = z
    .object({ calledNumber: z.string().min(1), serviceName: z.string().min(1), date: z.string().min(1), staffName: z.string().optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "calledNumber, serviceName, and date (YYYY-MM-DD) are required" });

  const business = await resolveBusinessByCalledNumber(parsed.data.calledNumber);
  if (!business) return res.status(404).json({ error: "No salon configured for this number" });
  if (rejectIfInquiry(business, res)) return;

  const service = await prisma.service.findFirst({ where: { businessId: business.id, name: { equals: parsed.data.serviceName, mode: "insensitive" } } });
  if (!service) {
    const all = await prisma.service.findMany({ where: { businessId: business.id }, select: { name: true } });
    return res.status(404).json({ error: "Unknown service", availableServices: all.map((s) => s.name) });
  }

  let staffId: string | undefined;
  if (parsed.data.staffName) {
    const staff = await prisma.staffMember.findFirst({ where: { businessId: business.id, name: { equals: parsed.data.staffName, mode: "insensitive" } } });
    if (!staff) {
      const all = await prisma.staffMember.findMany({ where: { businessId: business.id }, select: { name: true } });
      return res.status(404).json({ error: "Unknown staff member", availableStaff: all.map((s) => s.name) });
    }
    staffId = staff.id;
  }

  const slots = await findAvailableSlots(business.id, service.id, parsed.data.date, undefined, staffId);
  res.json({
    slots: slots.map((s) => ({ startTime: s.startTime, localTime: formatLocalTime(new Date(s.startTime), business.timezone), staffId: s.staffId })),
  });
});

// Books a slot returned by check-availability. startTime must be the exact ISO string that
// endpoint returned — same contract as the WhatsApp bot's book_appointment tool, to avoid the agent
// inventing/miscalculating a time itself.
voiceRouter.post("/book", async (req, res) => {
  const parsed = z
    .object({
      calledNumber: z.string().min(1),
      callerNumber: z.string().min(1),
      callerName: z.string().optional(),
      serviceName: z.string().min(1),
      startTime: z.string().min(1),
      staffName: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Missing required fields" });

  const business = await resolveBusinessByCalledNumber(parsed.data.calledNumber);
  if (!business) return res.status(404).json({ error: "No salon configured for this number" });
  if (rejectIfInquiry(business, res)) return;

  const service = await prisma.service.findFirst({ where: { businessId: business.id, name: { equals: parsed.data.serviceName, mode: "insensitive" } } });
  if (!service) return res.status(404).json({ error: "Unknown service" });

  let staffId: string | null | undefined;
  if (parsed.data.staffName) {
    const staff = await prisma.staffMember.findFirst({ where: { businessId: business.id, name: { equals: parsed.data.staffName, mode: "insensitive" } } });
    if (!staff) return res.status(404).json({ error: "Unknown staff member" });
    staffId = staff.id;
  }

  try {
    const appointment = await bookAppointmentWithSideEffects({
      businessId: business.id,
      serviceId: service.id,
      serviceName: service.name,
      customerPhone: parsed.data.callerNumber,
      customerName: parsed.data.callerName,
      startTime: parseBookingTime(parsed.data.startTime, business.timezone),
      staffId,
      staffName: parsed.data.staffName,
      ownerAlertPrefix: "📞 הזמנה חדשה (שיחת טלפון)!",
    });
    res.json({ booked: true, appointmentId: appointment.id, startTime: appointment.startTime, endTime: appointment.endTime });
  } catch (err) {
    if (err instanceof SlotUnavailableError) return res.status(409).json({ error: "Slot no longer available" });
    if (err instanceof OutsideBusinessHoursError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

// Cancels the given appointment (its id comes from /context's upcomingAppointment, or a future
// list-appointments tool) — scoped to the business, so a caller can never cancel someone else's.
voiceRouter.post("/cancel", async (req, res) => {
  const parsed = z.object({ calledNumber: z.string().min(1), appointmentId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "calledNumber and appointmentId are required" });

  const business = await resolveBusinessByCalledNumber(parsed.data.calledNumber);
  if (!business) return res.status(404).json({ error: "No salon configured for this number" });

  try {
    await cancelAppointmentById(business.id, parsed.data.appointmentId);
    res.json({ cancelled: true });
  } catch (err) {
    if (err instanceof AppointmentNotFoundError) return res.status(404).json({ error: "No matching appointment found" });
    throw err;
  }
});

// Reschedules to a new time (and optionally a new service/staff) — newStartTime follows the same
// "exact ISO string from check-availability" contract as /book.
voiceRouter.post("/reschedule", async (req, res) => {
  const parsed = z
    .object({
      calledNumber: z.string().min(1),
      appointmentId: z.string().min(1),
      newStartTime: z.string().min(1),
      newServiceName: z.string().optional(),
      newStaffName: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Missing required fields" });

  const business = await resolveBusinessByCalledNumber(parsed.data.calledNumber);
  if (!business) return res.status(404).json({ error: "No salon configured for this number" });
  if (rejectIfInquiry(business, res)) return;

  let newServiceId: string | undefined;
  if (parsed.data.newServiceName) {
    const service = await prisma.service.findFirst({ where: { businessId: business.id, name: { equals: parsed.data.newServiceName, mode: "insensitive" } } });
    if (!service) return res.status(404).json({ error: "Unknown service" });
    newServiceId = service.id;
  }

  let newStaffId: string | null | undefined;
  if (parsed.data.newStaffName) {
    const staff = await prisma.staffMember.findFirst({ where: { businessId: business.id, name: { equals: parsed.data.newStaffName, mode: "insensitive" } } });
    if (!staff) return res.status(404).json({ error: "Unknown staff member" });
    newStaffId = staff.id;
  }

  try {
    const appointment = await rescheduleAppointmentById({
      businessId: business.id,
      appointmentId: parsed.data.appointmentId,
      newStartTime: parseBookingTime(parsed.data.newStartTime, business.timezone),
      newServiceId,
      newStaffId,
      ownerAlertPrefix: "📞 שינוי מועד (שיחת טלפון)!",
    });
    res.json({ rescheduled: true, startTime: appointment.startTime, endTime: appointment.endTime });
  } catch (err) {
    if (err instanceof AppointmentNotFoundError) return res.status(404).json({ error: "No matching appointment found to reschedule" });
    if (err instanceof SlotUnavailableError) return res.status(409).json({ error: "New slot no longer available; original appointment kept" });
    if (err instanceof OutsideBusinessHoursError) return res.status(400).json({ error: err.message + "; original appointment kept" });
    throw err;
  }
});
