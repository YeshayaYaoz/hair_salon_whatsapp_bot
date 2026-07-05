import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { findAvailableSlots, createAppointment } from "../booking/availability.js";
import { hasActiveSubscription } from "../lib/subscriptionGate.js";

export const publicRouter = Router();

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
publicRouter.post("/:businessId/book", async (req, res) => {
  const parsed = bookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { serviceId, startTime, customerName, customerPhone } = parsed.data;
  const businessId = req.params.businessId;

  if (!(await hasActiveSubscription(businessId))) {
    return res.status(403).json({ error: "Salon is not currently accepting online bookings." });
  }

  const service = await prisma.service.findFirst({ where: { id: serviceId, businessId } });
  if (!service) return res.status(404).json({ error: "Service not found" });

  const appointment = await createAppointment({
    businessId,
    serviceId,
    customerPhone,
    customerName,
    startTime: new Date(startTime),
  });

  res.status(201).json({
    id: appointment.id,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    service: service.name,
  });
});
