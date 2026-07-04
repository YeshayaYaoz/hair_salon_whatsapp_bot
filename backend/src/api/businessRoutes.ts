import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { requireActiveSubscription } from "../lib/subscriptionGate.js";
import { getAuthUrl, saveGoogleTokens, disconnectGoogleCalendar } from "../lib/googleCalendar.js";
import { sendWhatsAppMessage } from "../webhook/whatsappClient.js";

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
  notificationPhone: z.string().optional(),
  botGreeting: z.string().optional(),
  botPersonality: z.string().optional(),
  googleMapsUrl: z.string().optional(),
  remindersEnabled: z.boolean().optional(),
  reviewsEnabled: z.boolean().optional(),
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

businessRouter.delete("/me/whatsapp", async (req: AuthedRequest, res) => {
  await prisma.business.update({
    where: { id: req.businessId! },
    data: { whatsappPhoneNumberId: null, whatsappAccessToken: null },
  });
  res.json({ ok: true });
});

// Embedded Signup: exchange the short-lived code Meta returns for a long-lived system user token,
// then fetch the phone number ID from the WABA and save everything.
businessRouter.post("/me/whatsapp/embedded-signup", async (req: AuthedRequest, res) => {
  const parsed = z.object({ code: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Missing code" });

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appId || !appSecret) return res.status(500).json({ error: "Meta app credentials not configured" });

  const redirectUri = "https://www.facebook.com/connect/login_success.html";
  const tokenRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${parsed.data.code}&redirect_uri=${encodeURIComponent(redirectUri)}`
  );
  const tokenData = await tokenRes.json() as any;
  if (!tokenData.access_token) {
    const metaMsg = tokenData?.error?.message ?? JSON.stringify(tokenData);
    console.error("Embedded signup token exchange failed:", tokenData);
    return res.status(400).json({ error: `Meta: ${metaMsg}` });
  }

  const userToken: string = tokenData.access_token;

  // Get the WhatsApp Business Accounts the user just shared
  const wabaRes = await fetch(
    `https://graph.facebook.com/v19.0/me/businesses?fields=owned_whatsapp_business_accounts{phone_numbers{id,display_phone_number}}&access_token=${userToken}`
  );
  const wabaData = await wabaRes.json() as any;

  // Pick the first phone number from the first WABA
  const phoneNumbers = wabaData?.data?.[0]?.owned_whatsapp_business_accounts?.data?.[0]?.phone_numbers?.data;
  const phone = phoneNumbers?.[0];
  if (!phone?.id) {
    console.error("Could not find phone number in embedded signup response:", JSON.stringify(wabaData));
    return res.status(400).json({ error: "No phone number found in connected account" });
  }

  // Subscribe the phone number's webhook to this app
  const wabaId = wabaData?.data?.[0]?.owned_whatsapp_business_accounts?.data?.[0]?.id;
  if (wabaId) {
    await fetch(`https://graph.facebook.com/v19.0/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
  }

  await prisma.business.update({
    where: { id: req.businessId! },
    data: {
      whatsappPhoneNumberId: phone.id,
      whatsappAccessToken: encryptSecret(userToken),
    },
  });

  res.json({ ok: true, phoneNumber: phone.display_phone_number });
});

// --- Services ---

const serviceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  priceCents: z.number().int().nonnegative(),
  durationMin: z.number().int().positive(),
  color: z.string().optional(),
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
  const appointment = await prisma.appointment.findFirst({
    where: { id: req.params.id, businessId: req.businessId! },
    include: { service: true },
  });
  if (!appointment) return res.status(404).json({ error: "Not found" });

  await prisma.appointment.update({ where: { id: req.params.id }, data: { status: "cancelled" } });
  res.json({ ok: true });

  // Notify waitlist after responding so the HTTP request isn't delayed
  notifyWaitlist(req.businessId!, appointment.serviceId, appointment.service.name, appointment.startTime).catch(
    (err) => console.error("[waitlist] Notification failed:", err)
  );
});

async function notifyWaitlist(businessId: string, serviceId: string, serviceName: string, startTime: Date) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { whatsappPhoneNumberId: true, whatsappAccessToken: true, name: true },
  });
  if (!business?.whatsappPhoneNumberId || !business.whatsappAccessToken) return;

  const waitlist = await prisma.waitlistEntry.findMany({
    where: { businessId, serviceId, notified: false },
    include: { customer: true },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  if (waitlist.length === 0) return;

  const accessToken = decryptSecret(business.whatsappAccessToken);
  const when = startTime.toLocaleString("he-IL", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

  for (const entry of waitlist) {
    const name = entry.customer.name ? entry.customer.name.split(" ")[0] : "היי";
    const text = `${name}! 🎉 פתח מקום ל${serviceName} ב-${when} אצל ${business.name}.\nרוצה לתפוס אותו? כתוב/י "כן" ואשריין לך את המקום!`;
    try {
      await sendWhatsAppMessage({
        phoneNumberId: business.whatsappPhoneNumberId,
        accessToken,
        to: entry.customer.phone,
        text,
      });
      await prisma.waitlistEntry.update({ where: { id: entry.id }, data: { notified: true } });
    } catch (err) {
      console.error(`[waitlist] Failed to notify ${entry.customer.phone}:`, err);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

// --- Customers ---

businessRouter.get("/customers", async (req: AuthedRequest, res) => {
  const customers = await prisma.customer.findMany({
    where: { businessId: req.businessId! },
    include: { _count: { select: { appointments: true } } },
    orderBy: { appointments: { _count: "desc" } },
  });
  res.json(customers);
});

businessRouter.post("/customers/:id/message", async (req: AuthedRequest, res) => {
  const parsed = z.object({ text: z.string().min(1).max(1000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id, businessId: req.businessId! },
  });
  if (!customer) return res.status(404).json({ error: "Not found" });

  const business = await prisma.business.findUnique({
    where: { id: req.businessId! },
    select: { whatsappPhoneNumberId: true, whatsappAccessToken: true },
  });
  if (!business?.whatsappPhoneNumberId || !business.whatsappAccessToken) {
    return res.status(400).json({ error: "WhatsApp not connected" });
  }

  const accessToken = decryptSecret(business.whatsappAccessToken);
  await sendWhatsAppMessage({
    phoneNumberId: business.whatsappPhoneNumberId,
    accessToken,
    to: customer.phone,
    text: parsed.data.text,
  });
  res.json({ ok: true });
});

// --- Waitlist ---

businessRouter.get("/waitlist", async (req: AuthedRequest, res) => {
  const entries = await prisma.waitlistEntry.findMany({
    where: { businessId: req.businessId! },
    include: { customer: true, service: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(entries);
});

businessRouter.patch("/waitlist/:id/notify", async (req: AuthedRequest, res) => {
  const result = await prisma.waitlistEntry.updateMany({
    where: { id: req.params.id, businessId: req.businessId! },
    data: { notified: true },
  });
  if (result.count === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

businessRouter.delete("/waitlist/:id", async (req: AuthedRequest, res) => {
  await prisma.waitlistEntry.deleteMany({ where: { id: req.params.id, businessId: req.businessId! } });
  res.json({ ok: true });
});

// --- Analytics ---

businessRouter.get("/analytics", async (req: AuthedRequest, res) => {
  const bizId = req.businessId!;
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const [monthAppts, weekAppts, topServices, newCustomers, allTimeCount] = await Promise.all([
    prisma.appointment.findMany({
      where: { businessId: bizId, startTime: { gte: startOfMonth } },
      include: { service: { select: { priceCents: true } } },
    }),
    prisma.appointment.findMany({
      where: { businessId: bizId, startTime: { gte: sevenDaysAgo }, status: "confirmed" },
      select: { startTime: true },
    }),
    prisma.appointment.groupBy({
      by: ["serviceId"],
      where: { businessId: bizId, status: "confirmed" },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }),
    prisma.customer.count({
      where: { businessId: bizId, appointments: { some: { startTime: { gte: startOfMonth } } } },
    }),
    prisma.appointment.count({ where: { businessId: bizId, status: "confirmed" } }),
  ]);

  const confirmedThisMonth = monthAppts.filter((a) => a.status === "confirmed");
  const cancelledThisMonth = monthAppts.filter((a) => a.status === "cancelled").length;
  const revenueThisMonth = confirmedThisMonth.reduce((sum, a) => sum + a.service.priceCents, 0);

  // Build daily counts for the last 7 days
  const dailyMap: Record<string, number> = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo);
    d.setDate(d.getDate() + i);
    dailyMap[d.toISOString().slice(0, 10)] = 0;
  }
  for (const a of weekAppts) {
    const key = a.startTime.toISOString().slice(0, 10);
    if (key in dailyMap) dailyMap[key]++;
  }
  const dailyThisWeek = Object.entries(dailyMap).map(([date, count]) => ({ date, count }));

  // Resolve service names for top services
  const serviceIds = topServices.map((s) => s.serviceId);
  const services = await prisma.service.findMany({
    where: { id: { in: serviceIds } },
    select: { id: true, name: true },
  });
  const nameMap = Object.fromEntries(services.map((s) => [s.id, s.name]));
  const topServicesList = topServices.map((s) => ({
    name: nameMap[s.serviceId] ?? "Unknown",
    count: s._count.id,
  }));

  res.json({
    confirmedThisMonth: confirmedThisMonth.length,
    cancelledThisMonth,
    revenueThisMonth,
    newCustomersThisMonth: newCustomers,
    allTimeConfirmed: allTimeCount,
    dailyThisWeek,
    topServices: topServicesList,
  });
});

// --- Google Calendar ---

businessRouter.get("/google-calendar/status", async (req: AuthedRequest, res) => {
  const record = await prisma.googleCalendarToken.findUnique({ where: { businessId: req.businessId! } });
  res.json({ connected: Boolean(record) });
});

businessRouter.get("/google-calendar/auth-url", async (req: AuthedRequest, res) => {
  const url = getAuthUrl(req.businessId!);
  res.json({ url });
});

businessRouter.post("/google-calendar/callback", async (req: AuthedRequest, res) => {
  const { code } = z.object({ code: z.string() }).parse(req.body);
  await saveGoogleTokens(req.businessId!, code);
  res.json({ ok: true });
});

businessRouter.delete("/google-calendar", async (req: AuthedRequest, res) => {
  await disconnectGoogleCalendar(req.businessId!);
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
