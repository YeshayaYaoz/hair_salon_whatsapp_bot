import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

export const voiceRouter = Router();

// Cartesia's agent hits this before speaking its first word (a "get context" tool call), so it's a
// single shared secret configured once in the Cartesia agent's tool auth header — not a per-business
// webhook secret like the payment webhooks, since Cartesia isn't relaying anything a customer could
// see or forge a request from.
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

voiceRouter.use(requireCartesiaAuth);

// Called once per incoming call, before the agent speaks — resolves which salon the dialed number
// belongs to, and whether the caller is an existing customer with an upcoming appointment, so the
// agent can open with something like "Hi Dana, calling about your appointment tomorrow?" instead of
// a blind generic greeting.
voiceRouter.post("/context", async (req, res) => {
  const parsed = z.object({ calledNumber: z.string().min(1), callerNumber: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "calledNumber and callerNumber are required" });

  const calledDigits = normalizePhone(parsed.data.calledNumber);
  const callerDigits = normalizePhone(parsed.data.callerNumber);

  // Prisma can't filter on a normalized expression without raw SQL, and voicePhoneNumber may be
  // stored with or without a leading "+" depending on how it was entered — fetch the (expected to
  // stay small) set of voice-enabled businesses and match on digits in memory instead.
  const candidates = await prisma.business.findMany({ where: { voicePhoneNumber: { not: null } }, select: { id: true, voicePhoneNumber: true } });
  const matched = candidates.find((b) => normalizePhone(b.voicePhoneNumber!) === calledDigits);
  if (!matched) return res.status(404).json({ error: "No salon configured for this number" });

  const [full, hours, customers] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: matched.id }, select: { name: true, timezone: true, address: true, botGreeting: true } }),
    prisma.businessHours.findMany({ where: { businessId: matched.id }, orderBy: { dayOfWeek: "asc" } }),
    prisma.customer.findMany({ where: { businessId: matched.id }, select: { id: true, phone: true, name: true } }),
  ]);
  const caller = customers.find((c) => normalizePhone(c.phone) === callerDigits);

  let upcomingAppointment: { serviceName: string; startTime: Date; staffName: string | null } | null = null;
  if (caller) {
    const appt = await prisma.appointment.findFirst({
      where: { businessId: matched.id, customerId: caller.id, status: "confirmed", startTime: { gte: new Date() } },
      orderBy: { startTime: "asc" },
      include: { service: { select: { name: true } }, staff: { select: { name: true } } },
    });
    if (appt) upcomingAppointment = { serviceName: appt.service.name, startTime: appt.startTime, staffName: appt.staff?.name ?? null };
  }

  res.json({
    businessName: full.name,
    timezone: full.timezone,
    address: full.address,
    greeting: full.botGreeting,
    hours: hours.map((h) => ({ dayOfWeek: h.dayOfWeek, openMin: h.openMin, closeMin: h.closeMin })),
    caller: caller
      ? { isKnownCustomer: true, name: caller.name, upcomingAppointment }
      : { isKnownCustomer: false, name: null, upcomingAppointment: null },
  });
});
