import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { encryptSecret } from "../lib/crypto.js";
import { requireActiveSubscription } from "../lib/subscriptionGate.js";

export const businessRouter = Router();
businessRouter.use(requireAuth);

// /me and /me/whatsapp stay reachable even with a lapsed subscription so a business can see its
// status and the billing UI can still load; everything else requires an active subscription.
businessRouter.use((req, res, next) => {
  if (req.path === "/me" || req.path === "/me/whatsapp") return next();
  requireActiveSubscription(req, res, next);
});

// --- Business profile + WhatsApp credentials ---

businessRouter.get("/me", async (req: AuthedRequest, res) => {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! } });
  const { passwordHash, whatsappAccessToken, ...safe } = business;
  res.json({ ...safe, whatsappConnected: Boolean(whatsappAccessToken) });
});

const whatsappSchema = z.object({
  phoneNumberId: z.string().min(1),
  accessToken: z.string().min(1),
});

const profileSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  timezone: z.string().optional(),
});

businessRouter.put("/me", async (req: AuthedRequest, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await prisma.business.update({ where: { id: req.businessId! }, data: parsed.data });
  res.json({ ok: true });
});

businessRouter.put("/me/whatsapp", async (req: AuthedRequest, res) => {
  const parsed = whatsappSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await prisma.business.update({
    where: { id: req.businessId! },
    data: {
      whatsappPhoneNumberId: parsed.data.phoneNumberId,
      whatsappAccessToken: encryptSecret(parsed.data.accessToken),
    },
  });
  res.json({ ok: true });
});

// --- Services ---

const serviceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  priceCents: z.number().int().nonnegative(),
  durationMin: z.number().int().positive(),
});

businessRouter.get("/services", async (req: AuthedRequest, res) => {
  const services = await prisma.service.findMany({ where: { businessId: req.businessId! } });
  res.json(services);
});

businessRouter.post("/services", async (req: AuthedRequest, res) => {
  const parsed = serviceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const service = await prisma.service.create({ data: { ...parsed.data, businessId: req.businessId! } });
  res.status(201).json(service);
});

businessRouter.put("/services/:id", async (req: AuthedRequest, res) => {
  const parsed = serviceSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const service = await prisma.service.updateMany({
    where: { id: req.params.id, businessId: req.businessId! },
    data: parsed.data,
  });
  if (service.count === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

businessRouter.delete("/services/:id", async (req: AuthedRequest, res) => {
  await prisma.service.deleteMany({ where: { id: req.params.id, businessId: req.businessId! } });
  res.json({ ok: true });
});

// --- Business hours ---

const hoursSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  openMin: z.number().int().min(0).max(1440),
  closeMin: z.number().int().min(0).max(1440),
});

businessRouter.get("/hours", async (req: AuthedRequest, res) => {
  const hours = await prisma.businessHours.findMany({ where: { businessId: req.businessId! }, orderBy: { dayOfWeek: "asc" } });
  res.json(hours);
});

businessRouter.put("/hours", async (req: AuthedRequest, res) => {
  const parsed = z.array(hoursSchema).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await prisma.$transaction([
    prisma.businessHours.deleteMany({ where: { businessId: req.businessId! } }),
    prisma.businessHours.createMany({
      data: parsed.data.map((h) => ({ ...h, businessId: req.businessId! })),
    }),
  ]);
  res.json({ ok: true });
});

// --- Staff ---

businessRouter.get("/staff", async (req: AuthedRequest, res) => {
  const staff = await prisma.staffMember.findMany({ where: { businessId: req.businessId! } });
  res.json(staff);
});

businessRouter.post("/staff", async (req: AuthedRequest, res) => {
  const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const staff = await prisma.staffMember.create({ data: { ...parsed.data, businessId: req.businessId! } });
  res.status(201).json(staff);
});

businessRouter.delete("/staff/:id", async (req: AuthedRequest, res) => {
  await prisma.staffMember.deleteMany({ where: { id: req.params.id, businessId: req.businessId! } });
  res.json({ ok: true });
});

// --- Appointments (read-only here; created by the bot) ---

businessRouter.get("/appointments", async (req: AuthedRequest, res) => {
  const appointments = await prisma.appointment.findMany({
    where: { businessId: req.businessId! },
    include: { customer: true, service: true, staff: true },
    orderBy: { startTime: "asc" },
  });
  res.json(appointments);
});

businessRouter.patch("/appointments/:id/cancel", async (req: AuthedRequest, res) => {
  const result = await prisma.appointment.updateMany({
    where: { id: req.params.id, businessId: req.businessId! },
    data: { status: "cancelled" },
  });
  if (result.count === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

// --- FAQ entries ---

const faqSchema = z.object({ question: z.string().min(1), answer: z.string().min(1) });

businessRouter.get("/faq", async (req: AuthedRequest, res) => {
  res.json(await prisma.faqEntry.findMany({ where: { businessId: req.businessId! } }));
});

businessRouter.post("/faq", async (req: AuthedRequest, res) => {
  const parsed = faqSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const entry = await prisma.faqEntry.create({ data: { ...parsed.data, businessId: req.businessId! } });
  res.status(201).json(entry);
});

businessRouter.delete("/faq/:id", async (req: AuthedRequest, res) => {
  await prisma.faqEntry.deleteMany({ where: { id: req.params.id, businessId: req.businessId! } });
  res.json({ ok: true });
});
