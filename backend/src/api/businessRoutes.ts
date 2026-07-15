import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { requireActiveSubscription } from "../lib/subscriptionGate.js";
import { getAuthUrl, saveGoogleTokens, disconnectGoogleCalendar, GoogleCalendarNotConfiguredError } from "../lib/googleCalendar.js";
import { sendWhatsAppMessage, getWabaId, createMessageTemplate, type CreateTemplateResult } from "../webhook/whatsappClient.js";
import { reminderTemplate, reviewTemplate, REMINDER_TEMPLATE_BODY, REVIEW_TEMPLATE_BODY } from "../lib/whatsappTemplates.js";
import { notifyWaitlist } from "../lib/waitlist.js";
import { createAppointment, OutsideBusinessHoursError, SlotUnavailableError } from "../booking/availability.js";
import { parseBookingTime } from "../lib/timezone.js";
import { getJobStatuses } from "../lib/jobStatus.js";
import { getPaymentProvider, PAYMENT_PROVIDERS, UnknownPaymentProviderError } from "../lib/payments/index.js";
import { getInvoiceProvider, INVOICE_PROVIDERS, UnknownInvoiceProviderError, resolveInvoiceCredentials } from "../lib/invoices/index.js";

export const businessRouter = Router();
businessRouter.use(requireAuth);

// /me and /me/whatsapp stay reachable even with a lapsed subscription so a business can see its
// status and the billing UI can still load; everything else requires an active subscription.
businessRouter.use((req, res, next) => {
  if (req.path === "/me" || req.path === "/me/whatsapp" || req.path === "/admin/businesses") return next();
  requireActiveSubscription(req, res, next);
});

// --- Business profile + WhatsApp credentials ---

businessRouter.get("/me", async (req: AuthedRequest, res) => {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! } });
  const { passwordHash, whatsappAccessToken, paymentApiKey, paymentApiSecret, invoiceApiKey, invoiceApiSecret, ...safe } = business;
  res.json({
    ...safe,
    whatsappConnected: Boolean(whatsappAccessToken),
    paymentConnected: Boolean(paymentApiKey),
    invoiceConnected:
      business.invoiceProvider === "payplus-invoice"
        ? business.paymentProvider === "payplus"
        : business.invoiceProvider === "tori_managed"
          ? true
          : Boolean(invoiceApiKey),
    isSuperAdmin: isSuperAdminEmail(business.email),
  });
  // (whatsappTokenValid is included in ...safe)
});

// --- Super-admin: lists every registered business (salon) using Tori. Gated by email match
// against SUPER_ADMIN_EMAIL rather than a separate role system, since there's currently exactly
// one operator account and adding a full RBAC system for that would be overkill. ---

function isSuperAdminEmail(email: string): boolean {
  const adminEmail = process.env.SUPER_ADMIN_EMAIL;
  return Boolean(adminEmail) && email.toLowerCase() === adminEmail!.toLowerCase();
}

export async function requireSuperAdmin(req: AuthedRequest, res: import("express").Response, next: import("express").NextFunction) {
  const business = await prisma.business.findUnique({ where: { id: req.businessId! }, select: { email: true } });
  if (!business || !isSuperAdminEmail(business.email)) return res.status(403).json({ error: "Not authorized" });
  next();
}

businessRouter.get("/admin/businesses", requireSuperAdmin, async (_req: AuthedRequest, res) => {
  const businesses = await prisma.business.findMany({
    select: {
      id: true, name: true, email: true, createdAt: true,
      subscriptionStatus: true, subscriptionPlan: true, billingCycle: true,
      whatsappPhoneNumberId: true, whatsappTokenValid: true,
      paymentProvider: true, invoiceProvider: true,
      walletBalanceAgorot: true, messagesUsedThisCycle: true,
      _count: { select: { appointments: true, customers: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(businesses.map((b) => ({ ...b, whatsappConnected: Boolean(b.whatsappPhoneNumberId) })));
});

// Global background job health (reminders/reviews/digest/retention) — same info for every
// business, since these jobs run once for the whole system rather than per-tenant.
businessRouter.get("/system-status", async (_req: AuthedRequest, res) => {
  res.json(await getJobStatuses());
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
  cancellationPolicy: z.string().max(500).optional(),
  referralText: z.string().max(500).optional(),
  digestEnabled: z.boolean().optional(),
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
      whatsappTokenValid: true, // freshly saved token is assumed valid
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

/**
 * Submits the reminder + review message templates for approval to this business's own WABA, so
 * the owner doesn't have to hand-create them in Meta Business Manager. Templates take up to ~24h
 * for Meta to review; this only submits the request. Safe to call repeatedly (existing templates
 * are reported as already-created, not an error) — e.g. if approval is rejected and resubmitted.
 */
businessRouter.post("/me/whatsapp/create-templates", async (req: AuthedRequest, res) => {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! } });
  if (!business.whatsappPhoneNumberId || !business.whatsappAccessToken) {
    return res.status(400).json({ error: "Connect a WhatsApp number first" });
  }

  const accessToken = decryptSecret(business.whatsappAccessToken);
  let wabaId: string;
  try {
    wabaId = await getWabaId(business.whatsappPhoneNumberId, accessToken);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Could not resolve WhatsApp Business Account" });
  }

  const reminder = reminderTemplate();
  const review = reviewTemplate();
  const results: CreateTemplateResult[] = await Promise.all([
    createMessageTemplate(wabaId, accessToken, { name: reminder.name, languageCode: reminder.languageCode, bodyText: REMINDER_TEMPLATE_BODY }),
    createMessageTemplate(wabaId, accessToken, { name: review.name, languageCode: review.languageCode, bodyText: REVIEW_TEMPLATE_BODY }),
  ]);
  res.json({ results });
});

// --- Payment provider (PayPlus / Tranzila / Cardcom / Grow / Tori-managed) — the business's own
// merchant account, except "tori_managed" which uses Tori's own account for a surcharge ---

// "tori_managed" needs no business-supplied credentials — Tori's own account handles it.
const paymentConnectSchema = z
  .object({
    provider: z.enum(PAYMENT_PROVIDERS),
    apiKey: z.string().min(1).optional(),
    apiSecret: z.string().min(1).optional(),
  })
  .refine((v) => v.provider === "tori_managed" || (v.apiKey && v.apiSecret), {
    message: "apiKey and apiSecret are required for this provider",
  });

businessRouter.put("/me/payment-provider", async (req: AuthedRequest, res) => {
  const parsed = paymentConnectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const provider = getPaymentProvider(parsed.data.provider);
  const creds = { apiKey: parsed.data.apiKey ?? "", apiSecret: parsed.data.apiSecret ?? "" };
  const verification = await provider.verifyCredentials(creds);
  if (!verification.valid) return res.status(400).json({ error: verification.error ?? "Invalid credentials" });

  await prisma.business.update({
    where: { id: req.businessId! },
    data: {
      paymentProvider: parsed.data.provider,
      paymentApiKey: parsed.data.provider === "tori_managed" ? "managed" : encryptSecret(parsed.data.apiKey!),
      paymentApiSecret: parsed.data.provider === "tori_managed" ? "managed" : encryptSecret(parsed.data.apiSecret!),
    },
  });
  res.json({ ok: true });
});

businessRouter.delete("/me/payment-provider", async (req: AuthedRequest, res) => {
  await prisma.business.update({
    where: { id: req.businessId! },
    data: { paymentProvider: null, paymentApiKey: null, paymentApiSecret: null },
  });
  res.json({ ok: true });
});

// --- Invoice provider (Green Invoice / iCount / PayPlus Invoice+ / Tori-managed) — issues the
// actual חשבונית/קבלה ---

// "payplus-invoice" and "tori_managed" don't need a business-supplied apiKey/apiSecret — the
// former reuses the PayPlus payment credentials, the latter uses Tori's own account.
const NO_KEYS_NEEDED = new Set(["payplus-invoice", "tori_managed"]);
const invoiceConnectSchema = z
  .object({
    provider: z.enum(INVOICE_PROVIDERS),
    apiKey: z.string().min(1).optional(),
    apiSecret: z.string().min(1).optional(),
  })
  .refine((v) => NO_KEYS_NEEDED.has(v.provider) || (v.apiKey && v.apiSecret), {
    message: "apiKey and apiSecret are required for this provider",
  });

businessRouter.put("/me/invoice-provider", async (req: AuthedRequest, res) => {
  const parsed = invoiceConnectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (parsed.data.provider === "payplus-invoice") {
    const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! }, select: { paymentProvider: true } });
    if (business.paymentProvider !== "payplus") {
      return res.status(400).json({ error: "Connect PayPlus as your payment provider first to use Invoice+" });
    }
    await prisma.business.update({
      where: { id: req.businessId! },
      data: { invoiceProvider: "payplus-invoice", invoiceApiKey: null, invoiceApiSecret: null },
    });
    return res.json({ ok: true });
  }

  if (parsed.data.provider === "tori_managed") {
    const provider = getInvoiceProvider("tori_managed");
    const verification = await provider.verifyCredentials({ apiKey: "", apiSecret: "" });
    if (!verification.valid) return res.status(400).json({ error: verification.error ?? "Managed invoicing isn't available right now" });
    await prisma.business.update({
      where: { id: req.businessId! },
      data: { invoiceProvider: "tori_managed", invoiceApiKey: null, invoiceApiSecret: null },
    });
    return res.json({ ok: true });
  }

  const provider = getInvoiceProvider(parsed.data.provider);
  const verification = await provider.verifyCredentials({ apiKey: parsed.data.apiKey!, apiSecret: parsed.data.apiSecret! });
  if (!verification.valid) return res.status(400).json({ error: verification.error ?? "Invalid credentials" });

  await prisma.business.update({
    where: { id: req.businessId! },
    data: {
      invoiceProvider: parsed.data.provider,
      invoiceApiKey: encryptSecret(parsed.data.apiKey!),
      invoiceApiSecret: encryptSecret(parsed.data.apiSecret!),
    },
  });
  res.json({ ok: true });
});

businessRouter.delete("/me/invoice-provider", async (req: AuthedRequest, res) => {
  await prisma.business.update({
    where: { id: req.businessId! },
    data: { invoiceProvider: null, invoiceApiKey: null, invoiceApiSecret: null },
  });
  res.json({ ok: true });
});

// Creates a hosted payment link via the business's connected provider (e.g. to send the
// customer a "pay now" link over WhatsApp for a specific appointment).
businessRouter.post("/payments/link", async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ amountIls: z.number().positive(), description: z.string().min(1), customerName: z.string().optional(), customerPhone: z.string().optional(), referenceId: z.string().min(1) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: req.businessId! },
    select: { paymentProvider: true, paymentApiKey: true, paymentApiSecret: true },
  });
  if (!business.paymentProvider || !business.paymentApiKey || !business.paymentApiSecret) {
    return res.status(400).json({ error: "No payment provider connected" });
  }

  try {
    const provider = getPaymentProvider(business.paymentProvider);
    // "tori_managed" ignores whatever creds are passed and uses Tori's own env-configured account.
    const creds =
      business.paymentProvider === "tori_managed"
        ? { apiKey: "", apiSecret: "" }
        : { apiKey: decryptSecret(business.paymentApiKey), apiSecret: decryptSecret(business.paymentApiSecret) };
    const result = await provider.createPaymentLink(creds, parsed.data);
    res.json(result);
  } catch (err) {
    if (err instanceof UnknownPaymentProviderError) return res.status(400).json({ error: err.message });
    console.error("Payment link creation failed:", err);
    res.status(502).json({ error: "Payment provider request failed" });
  }
});

// Issues a receipt/invoice via the business's connected invoicing provider — call this after a
// payment has actually been confirmed (e.g. from the payment provider's success webhook).
businessRouter.post("/invoices/receipt", async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ amountIls: z.number().positive(), description: z.string().min(1), customerName: z.string().min(1), customerPhone: z.string().optional(), customerEmail: z.string().email().optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: req.businessId! },
    select: { invoiceProvider: true, invoiceApiKey: true, invoiceApiSecret: true, paymentProvider: true, paymentApiKey: true, paymentApiSecret: true },
  });
  const resolved = resolveInvoiceCredentials(business);
  if (!resolved) return res.status(400).json({ error: "No invoice provider connected" });

  try {
    const provider = getInvoiceProvider(resolved.provider);
    const result = await provider.createReceipt(resolved.credentials, parsed.data);
    res.json(result);
  } catch (err) {
    if (err instanceof UnknownInvoiceProviderError) return res.status(400).json({ error: err.message });
    console.error("Receipt creation failed:", err);
    res.status(502).json({ error: "Invoice provider request failed" });
  }
});

// Embedded Signup: receive the access token from FB.login (response_type: "token"),
// then fetch the phone number ID from the WABA and save everything.
businessRouter.post("/me/whatsapp/embedded-signup", async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ accessToken: z.string().min(1), wabaId: z.string().optional(), phoneNumberId: z.string().optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Missing accessToken" });

  const userToken: string = parsed.data.accessToken;

  let phone: { id: string; display_phone_number: string } | undefined;
  let wabaId: string | undefined;
  const debugTrail: Record<string, unknown> = {};

  // Primary path: the waba_id/phone_number_id Meta posts to the frontend via the
  // WA_EMBEDDED_SIGNUP postMessage event during the signup flow itself — the documented,
  // reliable source. Prefer these over any Graph API reconstruction attempted afterward, which
  // depends on permissions/scopes that turned out not to be consistently granted.
  if (parsed.data.phoneNumberId) {
    const phoneRes = await fetch(
      `https://graph.facebook.com/v20.0/${parsed.data.phoneNumberId}?fields=id,display_phone_number&access_token=${encodeURIComponent(userToken)}`
    );
    const phoneData = await phoneRes.json() as any;
    debugTrail.postMessagePhone = phoneData?.error ?? "ok";
    if (phoneData?.id) {
      phone = { id: phoneData.id, display_phone_number: phoneData.display_phone_number };
      wabaId = parsed.data.wabaId;
    }
  }

  // Fallback 1: debug_token → granular_scopes. Discovers which WABAs the user granted during
  // signup without needing business_management — works when the postMessage above didn't fire
  // (e.g. an ad/popup blocker interfering) but the login itself still succeeded.
  if (!phone) {
    const debugRes = await fetch(
      `https://graph.facebook.com/v20.0/debug_token?input_token=${encodeURIComponent(userToken)}&access_token=${encodeURIComponent(userToken)}`
    );
    const debugData = await debugRes.json() as any;
    debugTrail.debugToken = debugData?.error ?? "ok";
    const granted: { scope: string; target_ids?: string[] }[] = debugData?.data?.granular_scopes ?? [];
    const wabaIds: string[] =
      granted.find((s) => s.scope === "whatsapp_business_management")?.target_ids ??
      granted.find((s) => s.scope === "whatsapp_business_messaging")?.target_ids ?? [];

    for (const id of wabaIds) {
      const phoneRes = await fetch(
        `https://graph.facebook.com/v20.0/${id}/phone_numbers?fields=id,display_phone_number&access_token=${encodeURIComponent(userToken)}`
      );
      const phoneData = await phoneRes.json() as any;
      debugTrail[`waba_${id}`] = phoneData?.error ?? `found ${phoneData?.data?.length ?? 0} numbers`;
      if (phoneData?.data?.[0]?.id) {
        phone = phoneData.data[0];
        wabaId = id;
        break;
      }
    }
  }

  // Fallback 2: me/businesses (works only if the token also has business_management — kept for
  // manually-created tokens pasted through this endpoint, not the Embedded Signup flow).
  if (!phone) {
    const bizRes = await fetch(
      `https://graph.facebook.com/v20.0/me/businesses?fields=owned_whatsapp_business_accounts{id,phone_numbers{id,display_phone_number}}&access_token=${encodeURIComponent(userToken)}`
    );
    const bizData = await bizRes.json() as any;
    debugTrail.meBusinesses = bizData?.error ?? "ok";
    const waba1 = bizData?.data?.[0]?.owned_whatsapp_business_accounts?.data?.[0];
    if (waba1?.phone_numbers?.data?.[0]?.id) {
      phone = waba1.phone_numbers.data[0];
      wabaId = waba1.id;
    }
  }

  if (!phone) {
    console.error("[embedded-signup] Could not find phone number:", JSON.stringify(debugTrail));
    return res.status(400).json({
      error: "לא נמצא מספר וואטסאפ בחשבון שחובר. ודאו שהשלמתם את כל שלבי החיבור של מטא (כולל בחירת מספר טלפון), ונסו שוב.",
      debug: debugTrail,
    });
  }
  if (wabaId) {
    await fetch(`https://graph.facebook.com/v20.0/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
  }

  await prisma.business.update({
    where: { id: req.businessId! },
    data: {
      whatsappPhoneNumberId: phone.id,
      whatsappAccessToken: encryptSecret(userToken),
      whatsappTokenValid: true,
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

// --- Appointments ---

/** Manual booking from the dashboard (phone bookings, walk-ins). Same validation as the bot. */
businessRouter.post("/appointments", async (req: AuthedRequest, res) => {
  const parsed = z.object({
    serviceId: z.string().min(1),
    customerName: z.string().min(1),
    customerPhone: z.string().min(3),
    startTime: z.string().min(1), // local wall time "YYYY-MM-DDTHH:mm" or ISO
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! }, select: { timezone: true } });
  const service = await prisma.service.findFirst({ where: { id: parsed.data.serviceId, businessId: req.businessId! } });
  if (!service) return res.status(404).json({ error: "Service not found" });

  try {
    const appointment = await createAppointment({
      businessId: req.businessId!,
      serviceId: service.id,
      customerPhone: parsed.data.customerPhone.replace(/[^\d+]/g, ""),
      customerName: parsed.data.customerName,
      startTime: parseBookingTime(parsed.data.startTime, business.timezone || "Asia/Jerusalem"),
    });
    res.status(201).json(appointment);
  } catch (err) {
    if (err instanceof OutsideBusinessHoursError) return res.status(400).json({ error: "מחוץ לשעות הפעילות או בתקופת חופשה" });
    if (err instanceof SlotUnavailableError) return res.status(409).json({ error: "המועד תפוס — בחר שעה אחרת" });
    throw err;
  }
});

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

// --- Blocked times (vacations, breaks, holidays) ---

businessRouter.get("/blocked-times", async (req: AuthedRequest, res) => {
  const blocks = await prisma.blockedTime.findMany({
    where: { businessId: req.businessId!, endTime: { gte: new Date() } },
    orderBy: { startTime: "asc" },
  });
  res.json(blocks);
});

businessRouter.post("/blocked-times", async (req: AuthedRequest, res) => {
  const parsed = z.object({
    startTime: z.string().min(1), // local wall time "YYYY-MM-DDTHH:mm"
    endTime: z.string().min(1),
    reason: z.string().max(200).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! }, select: { timezone: true } });
  const tz = business.timezone || "Asia/Jerusalem";
  const start = parseBookingTime(parsed.data.startTime, tz);
  const end = parseBookingTime(parsed.data.endTime, tz);
  if (end <= start) return res.status(400).json({ error: "End must be after start" });

  const block = await prisma.blockedTime.create({
    data: { businessId: req.businessId!, startTime: start, endTime: end, reason: parsed.data.reason },
  });
  res.status(201).json(block);
});

businessRouter.delete("/blocked-times/:id", async (req: AuthedRequest, res) => {
  await prisma.blockedTime.deleteMany({ where: { id: req.params.id, businessId: req.businessId! } });
  res.json({ ok: true });
});

// --- Bot conversations (read-only transcripts) ---

businessRouter.get("/conversations", async (req: AuthedRequest, res) => {
  // Group persisted bot messages by customer phone, newest conversations first.
  const grouped = await prisma.conversationMessage.groupBy({
    by: ["phone"],
    where: { businessId: req.businessId! },
    _count: { _all: true },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: 100,
  });
  const phones = grouped.map((g) => g.phone);
  const customers = await prisma.customer.findMany({
    where: { businessId: req.businessId!, phone: { in: phones } },
    select: { phone: true, name: true },
  });
  const nameByPhone = new Map(customers.map((c) => [c.phone, c.name]));
  res.json(
    grouped.map((g) => ({
      phone: g.phone,
      customerName: nameByPhone.get(g.phone) ?? null,
      messageCount: g._count._all,
      lastMessageAt: g._max.createdAt,
    }))
  );
});

businessRouter.get("/conversations/:phone", async (req: AuthedRequest, res) => {
  const messages = await prisma.conversationMessage.findMany({
    where: { businessId: req.businessId!, phone: req.params.phone },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  res.json(messages);
});

// --- Customers ---

businessRouter.get("/customers", async (req: AuthedRequest, res) => {
  const customers = await prisma.customer.findMany({
    where: { businessId: req.businessId! },
    // Count only confirmed bookings — cancelled appointments shouldn't inflate "total bookings".
    include: { _count: { select: { appointments: { where: { status: "confirmed" } } } } },
    orderBy: { name: "asc" },
  });
  customers.sort((a, b) => b._count.appointments - a._count.appointments);
  res.json(customers);
});

businessRouter.patch("/customers/:id/notes", async (req: AuthedRequest, res) => {
  const parsed = z.object({ notes: z.string().max(2000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id, businessId: req.businessId! },
  });
  if (!customer) return res.status(404).json({ error: "Not found" });

  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: { notes: parsed.data.notes || null },
  });
  res.json({ notes: updated.notes });
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

  // Start of the 7-day window *before* the current one — used for the week-over-week trend.
  const fourteenDaysAgo = new Date(sevenDaysAgo);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 7);

  const [monthAppts, weekAppts, prevWeekCount, topServices, newCustomers, allTimeCount] = await Promise.all([
    prisma.appointment.findMany({
      where: { businessId: bizId, startTime: { gte: startOfMonth } },
      include: { service: { select: { priceCents: true } } },
    }),
    prisma.appointment.findMany({
      where: { businessId: bizId, startTime: { gte: sevenDaysAgo }, status: "confirmed" },
      select: { startTime: true },
    }),
    prisma.appointment.count({
      where: { businessId: bizId, status: "confirmed", startTime: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
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
    prevWeekConfirmed: prevWeekCount,
    topServices: topServicesList,
  });
});

// --- Google Calendar ---

businessRouter.get("/google-calendar/status", async (req: AuthedRequest, res) => {
  const record = await prisma.googleCalendarToken.findUnique({ where: { businessId: req.businessId! } });
  res.json({ connected: Boolean(record) });
});

businessRouter.get("/google-calendar/auth-url", async (req: AuthedRequest, res) => {
  try {
    const url = getAuthUrl(req.businessId!);
    res.json({ url });
  } catch (err) {
    if (err instanceof GoogleCalendarNotConfiguredError) {
      return res.status(503).json({ error: "אינטגרציית Google Calendar אינה מוגדרת בשרת. פנה לתמיכה." });
    }
    throw err;
  }
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
