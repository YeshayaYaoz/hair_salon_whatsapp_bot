import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { findAvailableSlots, createAppointment, OutsideBusinessHoursError, SlotUnavailableError } from "../booking/availability.js";
import { hasActiveSubscription } from "../lib/subscriptionGate.js";
import { rateLimit } from "../lib/rateLimit.js";

export const publicRouter = Router();

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

  let appointment;
  try {
    appointment = await createAppointment({
      businessId,
      serviceId,
      customerPhone,
      customerName,
      startTime: new Date(startTime),
    });
  } catch (err) {
    if (err instanceof OutsideBusinessHoursError) return res.status(400).json({ error: "That time is outside business hours." });
    if (err instanceof SlotUnavailableError) return res.status(409).json({ error: "That slot was just taken. Please pick another." });
    throw err;
  }

  res.status(201).json({
    id: appointment.id,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    service: service.name,
  });
});
