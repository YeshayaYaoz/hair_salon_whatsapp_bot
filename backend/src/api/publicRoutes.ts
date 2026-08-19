import { asyncRouter } from "../lib/asyncRouter.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { findAvailableSlots, createAppointment, OutsideBusinessHoursError, SlotUnavailableError } from "../booking/availability.js";
import { isDepositRequired, depositHoldFields, createDepositLink, releaseHold } from "../booking/deposits.js";
import { hasActiveSubscription } from "../lib/subscriptionGate.js";
import { notifyOwner } from "../lib/ownerNotify.js";
import { syncAppointmentToCalendar } from "../lib/googleCalendar.js";
import { captureError } from "../lib/errorMonitoring.js";
import { rateLimit } from "../lib/rateLimit.js";

export const publicRouter = asyncRouter();

// This whole router is unauthenticated by design (it's the public booking widget), so it's the
// one surface anyone could hammer with a script. Reads are looser (a real customer browsing
// services/slots), writes are tight (nobody legitimately submits more than a couple bookings a
// minute from one IP).
const publicReadLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, keyPrefix: "public-read" });
const publicBookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: "public-book",
  message: "יותר מדי בקשות הזמנה. אנא נסו שוב בעוד כמה דקות.",
});
publicRouter.use(publicReadLimiter);

// Cache stats briefly so the landing page can't hammer the DB.
let statsCache: { at: number; data: { businesses: number; appointments: number } } | null = null;
const STATS_TTL_MS = 5 * 60 * 1000;

/** Aggregate social-proof numbers for the marketing site. Declared before the /:businessId catch-all. */
publicRouter.get("/stats/summary", async (_req, res) => {
  if (statsCache && Date.now() - statsCache.at < STATS_TTL_MS) {
    return res.json(statsCache.data);
  }
  const [businesses, appointments] = await Promise.all([
    prisma.business.count(),
    prisma.appointment.count(),
  ]);
  const data = { businesses, appointments };
  statsCache = { at: Date.now(), data };
  res.json(data);
});

/** Public business info — used by the web booking page. */
publicRouter.get("/:businessId", async (req, res) => {
  const business = await prisma.business.findUnique({
    where: { id: req.params.businessId },
    include: { services: true, hours: { orderBy: { dayOfWeek: "asc" } } },
  });
  if (!business) return res.status(404).json({ error: "Not found" });
  if (!(await hasActiveSubscription(business.id))) {
    return res.status(403).json({ error: "Salon is not currently accepting online bookings." });
  }

  res.json({
    id: business.id,
    name: business.name,
    address: business.address,
    // The booking page renders slot times, and a customer browsing from another timezone would
    // otherwise see them shifted by the offset — same reasoning as admin/app/lib/tz.ts.
    timezone: business.timezone,
    // Published on this business's accessibility statement. Deliberately part of the public
    // payload: the statement is a public document, and a contact nobody can reach defeats it.
    accessibilityContact: business.accessibilityContact,
    services: business.services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      priceCents: s.priceCents,
      durationMin: s.durationMin,
    })),
    hours: business.hours,
  });
});

/** Available slots for a service on a given date. */
publicRouter.get("/:businessId/slots", async (req, res) => {
  const { serviceId, date } = req.query;
  if (!serviceId || !date) return res.status(400).json({ error: "serviceId and date required" });

  const service = await prisma.service.findFirst({
    where: { id: serviceId as string, businessId: req.params.businessId },
  });
  if (!service) return res.status(404).json({ error: "Service not found" });

  const slots = await findAvailableSlots(req.params.businessId, service.id, new Date(date as string));
  res.json(slots);
});

const bookSchema = z.object({
  serviceId: z.string(),
  startTime: z.string(),
  customerName: z.string().min(1),
  customerPhone: z.string().min(1),
});

/** Public booking — no auth required. */
publicRouter.post("/:businessId/book", publicBookLimiter, async (req, res) => {
  const parsed = bookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { serviceId, startTime, customerName, customerPhone } = parsed.data;
  const businessId = req.params.businessId;

  if (!(await hasActiveSubscription(businessId))) {
    return res.status(403).json({ error: "Salon is not currently accepting online bookings." });
  }

  const service = await prisma.service.findFirst({ where: { id: serviceId, businessId } });
  if (!service) return res.status(404).json({ error: "Service not found" });

  // The same business fields the WhatsApp bot consults before booking. This endpoint used to skip
  // the question entirely and hand out confirmed slots for free — through the booking link the
  // salon puts on its own website — while requiring a deposit from anyone who booked over WhatsApp.
  const biz = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      name: true, timezone: true,
      depositEnabled: true, depositAmountIls: true, depositHoldMinutes: true,
      paymentProvider: true, paymentApiKey: true, paymentApiSecret: true,
      paymentPageUid: true, paymentWebhookSecret: true,
    },
  });
  const depositRequired = isDepositRequired(biz);

  let appointment;
  try {
    appointment = await createAppointment({
      businessId,
      serviceId,
      customerPhone,
      customerName,
      startTime: new Date(startTime),
      ...(depositRequired ? depositHoldFields(biz) : {}),
    });
  } catch (err) {
    if (err instanceof OutsideBusinessHoursError) return res.status(400).json({ error: "That time is outside business hours." });
    if (err instanceof SlotUnavailableError) return res.status(409).json({ error: "That slot was just taken. Please pick another." });
    throw err;
  }

  if (depositRequired) {
    // Nothing is announced or synced yet: this is a hold, not a booking. The deposit webhook
    // confirms it, alerts the owner and syncs the calendar once the money actually arrives.
    try {
      const paymentUrl = await createDepositLink({
        businessId,
        biz,
        appointmentId: appointment.id,
        serviceName: service.name,
        customerName,
        customerPhone,
      });
      return res.status(201).json({
        id: appointment.id,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        service: service.name,
        depositRequired: true,
        depositAmountIls: biz.depositAmountIls,
        holdMinutes: biz.depositHoldMinutes,
        paymentUrl,
      });
    } catch (err) {
      // Release the hold rather than leaving a pending_payment row blocking the slot for the whole
      // hold window with no link anyone could pay.
      console.error("Deposit payment link creation failed (public booking):", err);
      captureError(err, { businessId, phase: "deposit_link_public" });
      await releaseHold(appointment.id);
      return res.status(502).json({ error: "Could not start the deposit payment. Please try again in a moment, or contact the business directly." });
    }
  }

  // Both of these were missing: a web booking reached no owner and no calendar, so it existed only
  // in the dashboard until someone thought to look.
  const tz = biz.timezone || "Asia/Jerusalem";
  const when = appointment.startTime.toLocaleString("he-IL", {
    timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
  notifyOwner(businessId, `🌐 הזמנה חדשה מהאתר!\nלקוח: ${customerName} (${customerPhone})\nשירות: ${service.name}\nמועד: ${when}`);

  syncAppointmentToCalendar(businessId, {
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    serviceName: service.name,
    customerName,
    customerPhone,
  })
    .then((eventId) => {
      if (eventId) return prisma.appointment.update({ where: { id: appointment.id }, data: { calendarEventId: eventId } });
    })
    .catch((err) => console.error("Calendar sync failed (public booking):", err));

  res.status(201).json({
    id: appointment.id,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    service: service.name,
  });
});
