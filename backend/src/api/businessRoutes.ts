import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, signImpersonationToken, type AuthedRequest } from "../lib/auth.js";
import { logAdminAction } from "../lib/adminAudit.js";
import { sendAdminAlertEmail, sendBusinessNoticeEmail } from "../lib/email.js";
import { captureError } from "../lib/errorMonitoring.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { requireActiveSubscription } from "../lib/subscriptionGate.js";
import { getAuthUrl, saveGoogleTokens, disconnectGoogleCalendar, deleteCalendarEvent, GoogleCalendarNotConfiguredError } from "../lib/googleCalendar.js";
import { sendWhatsAppMessage, getWabaId, subscribeAppToWaba, registerPhoneNumber, getPhoneNumberStatus, getSubscribedApps, createMessageTemplate, setWhatsAppProfilePicture, type CreateTemplateResult } from "../webhook/whatsappClient.js";
import { reminderTemplate, reviewTemplate, REMINDER_TEMPLATE_BODY, REVIEW_TEMPLATE_BODY } from "../lib/whatsappTemplates.js";
import { notifyWaitlist } from "../lib/waitlist.js";
import { appendTurn } from "../bot/conversationStore.js";
import { createAppointment, OutsideBusinessHoursError, SlotUnavailableError } from "../booking/availability.js";
import { parseBookingTime } from "../lib/timezone.js";
import { getJobStatuses } from "../lib/jobStatus.js";
import { listTemplates, BUSINESS_TYPES } from "../lib/businessTemplates.js";
import { AI_PROVIDER_KEYS } from "../bot/providers/index.js";
import { applyTemplate } from "../lib/applyTemplate.js";
import { getPaymentProvider, PAYMENT_PROVIDERS, UnknownPaymentProviderError } from "../lib/payments/index.js";
import { getInvoiceProvider, INVOICE_PROVIDERS, UnknownInvoiceProviderError, resolveInvoiceCredentials } from "../lib/invoices/index.js";

export const businessRouter = Router();
businessRouter.use(requireAuth);

// /me and /me/whatsapp stay reachable even with a lapsed subscription so a business can see its
// status and the billing UI can still load; everything else requires an active subscription.
businessRouter.use((req, res, next) => {
  if (req.path === "/me" || req.path === "/me/whatsapp" || req.path.startsWith("/admin/")) return next();
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

/** 6-digit two-step verification PIN for Cloud API phone registration. */
function generateRegistrationPin(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

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
      paymentProvider: true, invoiceProvider: true, depositEnabled: true,
      walletBalanceAgorot: true, messagesUsedThisCycle: true,
      blockedAt: true, blockedReason: true,
      _count: { select: { appointments: true, customers: true, services: true, hours: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Real, metered cost from the last 30 days — actual Anthropic token usage (exact, computed from
  // Anthropic's own published rates) plus a count of real billable WhatsApp messages per Meta's
  // own billing-status callbacks. No estimation: businesses with zero events here simply show ₪0,
  // which reflects the ledger, not a fallback guess.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [claudeCosts, whatsappBillable] = await Promise.all([
    prisma.apiUsageEvent.groupBy({
      by: ["businessId"],
      where: { kind: "claude", createdAt: { gte: since } },
      _sum: { costAgorot: true, inputTokens: true, outputTokens: true },
    }),
    prisma.apiUsageEvent.groupBy({
      by: ["businessId"],
      where: { kind: "whatsapp", billable: true, createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);
  const claudeByBusiness = new Map(claudeCosts.map((c) => [c.businessId, c]));
  const whatsappByBusiness = new Map(whatsappBillable.map((w) => [w.businessId, w._count._all]));

  res.json(
    businesses.map((b) => {
      const claude = claudeByBusiness.get(b.id);
      // Per-business onboarding checklist — the concrete setup steps a salon must complete before
      // the bot is actually useful, so the operator can see at a glance who's stuck mid-setup and
      // who to nudge, instead of guessing from indirect signals.
      const onboarding = {
        whatsapp: Boolean(b.whatsappPhoneNumberId),
        services: b._count.services > 0,
        hours: b._count.hours > 0,
        payment: Boolean(b.paymentProvider),
      };
      const onboardingDone = Object.values(onboarding).filter(Boolean).length;
      return {
        ...b,
        whatsappConnected: Boolean(b.whatsappPhoneNumberId),
        realClaudeCostAgorot30d: claude?._sum.costAgorot ?? 0,
        realClaudeTokens30d: (claude?._sum.inputTokens ?? 0) + (claude?._sum.outputTokens ?? 0),
        realWhatsappBillableCount30d: whatsappByBusiness.get(b.id) ?? 0,
        onboarding,
        onboardingDone,
        onboardingTotal: 4,
      };
    })
  );
});

// Real per-phone-number usage breakdown for one business — backs the drill-down in the
// super-admin panel. Every row here is an actual recorded API call, not an estimate.
businessRouter.get("/admin/usage-by-phone", requireSuperAdmin, async (req: AuthedRequest, res) => {
  const businessId = req.query.businessId as string | undefined;
  if (!businessId) return res.status(400).json({ error: "businessId required" });

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const events = await prisma.apiUsageEvent.findMany({
    where: { businessId, createdAt: { gte: since } },
    select: { customerPhone: true, kind: true, costAgorot: true, inputTokens: true, outputTokens: true, category: true, billable: true },
  });

  const byPhone = new Map<
    string,
    { customerPhone: string; claudeCostAgorot: number; claudeTokens: number; whatsappBillableCount: number; whatsappByCategory: Record<string, number> }
  >();
  for (const e of events) {
    if (!byPhone.has(e.customerPhone)) {
      byPhone.set(e.customerPhone, { customerPhone: e.customerPhone, claudeCostAgorot: 0, claudeTokens: 0, whatsappBillableCount: 0, whatsappByCategory: {} });
    }
    const row = byPhone.get(e.customerPhone)!;
    if (e.kind === "claude") {
      row.claudeCostAgorot += e.costAgorot ?? 0;
      row.claudeTokens += (e.inputTokens ?? 0) + (e.outputTokens ?? 0);
    } else if (e.kind === "whatsapp" && e.billable) {
      row.whatsappBillableCount += 1;
      const cat = e.category ?? "unknown";
      row.whatsappByCategory[cat] = (row.whatsappByCategory[cat] ?? 0) + 1;
    }
  }

  res.json(Array.from(byPhone.values()).sort((a, b) => b.claudeCostAgorot - a.claudeCostAgorot));
});

// Block/suspend a business: independent of subscriptionStatus (see schema comment) — locks out
// dashboard login and stops the WhatsApp bot from replying, without touching billing state, so a
// support/fraud suspension doesn't get silently undone by the next successful charge.
const blockSchema = z.object({ reason: z.string().max(500).optional() });
businessRouter.post("/admin/businesses/:id/block", requireSuperAdmin, async (req: AuthedRequest, res) => {
  const parsed = blockSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const business = await prisma.business.update({
    where: { id: req.params.id },
    data: { blockedAt: new Date(), blockedReason: parsed.data.reason ?? null },
  });
  await logAdminAction({
    actorEmail: process.env.SUPER_ADMIN_EMAIL!,
    action: "block",
    targetBusinessId: business.id,
    targetBusinessName: business.name,
    details: parsed.data.reason,
  });
  res.json({ ok: true, blockedAt: business.blockedAt });
});

businessRouter.post("/admin/businesses/:id/unblock", requireSuperAdmin, async (req: AuthedRequest, res) => {
  const business = await prisma.business.update({ where: { id: req.params.id }, data: { blockedAt: null, blockedReason: null } });
  await logAdminAction({
    actorEmail: process.env.SUPER_ADMIN_EMAIL!,
    action: "unblock",
    targetBusinessId: business.id,
    targetBusinessName: business.name,
  });
  res.json({ ok: true });
});

// Manually set a business's plan/subscription — for comping an account, a sales-negotiated
// upgrade, or fixing a stuck billing state. Setting subscriptionStatus to "active" here does NOT
// create a PayPlus recurring token — it just marks the account as paid, same as a successful
// charge would; the business's OWN recurring billing (if any) is untouched.
const planSchema = z.object({
  plan: z.enum(["standard", "premium"]),
  billingCycle: z.enum(["monthly", "annual"]).optional(),
  subscriptionStatus: z.enum(["trial", "active", "past_due", "canceled"]).optional(),
});
businessRouter.post("/admin/businesses/:id/plan", requireSuperAdmin, async (req: AuthedRequest, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const before = await prisma.business.findUnique({ where: { id: req.params.id }, select: { subscriptionPlan: true, subscriptionStatus: true } });
  const business = await prisma.business.update({
    where: { id: req.params.id },
    data: {
      subscriptionPlan: parsed.data.plan,
      ...(parsed.data.billingCycle ? { billingCycle: parsed.data.billingCycle } : {}),
      subscriptionStatus: parsed.data.subscriptionStatus ?? "active",
    },
  });
  await logAdminAction({
    actorEmail: process.env.SUPER_ADMIN_EMAIL!,
    action: "set_plan",
    targetBusinessId: business.id,
    targetBusinessName: business.name,
    details: `${before?.subscriptionPlan ?? "none"}/${before?.subscriptionStatus} → ${business.subscriptionPlan}/${business.subscriptionStatus}`,
  });

  if (before?.subscriptionStatus !== "canceled" && business.subscriptionStatus === "canceled") {
    sendAdminAlertEmail(
      `📉 עסק בוטל — ${business.name}`,
      `<h2 style="color:#fff;margin-bottom:8px;">${business.name} עבר לסטטוס "בוטל"</h2><p style="color:#a1a1aa;">שונה ידנית דרך פאנל הניהול.</p>`
    ).catch((err) => console.error("[admin] Churn alert email failed:", err));
  }

  res.json({ ok: true, subscriptionPlan: business.subscriptionPlan, subscriptionStatus: business.subscriptionStatus });
});

// Permanently deletes a business and every row scoped to it. No cascade at the DB level (kept
// explicit and in dependency order on purpose — an accidental ON DELETE CASCADE is how you lose
// a business by mistake). Requires re-typing the business's exact name as confirmation, since this
// is unrecoverable and wipes real appointment/customer history, not just account access — for
// almost every real case, block (above) is the right tool; this is for GDPR-style erasure requests
// or definitively fake/test accounts.
const deleteSchema = z.object({ confirmName: z.string() });
businessRouter.delete("/admin/businesses/:id", requireSuperAdmin, async (req: AuthedRequest, res) => {
  const parsed = deleteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const business = await prisma.business.findUnique({ where: { id: req.params.id }, select: { name: true } });
  if (!business) return res.status(404).json({ error: "Not found" });
  if (parsed.data.confirmName.trim() !== business.name) {
    return res.status(400).json({ error: "Business name confirmation does not match" });
  }

  const businessId = req.params.id;
  await prisma.$transaction([
    prisma.appointment.deleteMany({ where: { businessId } }),
    prisma.waitlistEntry.deleteMany({ where: { businessId } }),
    prisma.customer.deleteMany({ where: { businessId } }),
    prisma.service.deleteMany({ where: { businessId } }),
    prisma.staffMember.deleteMany({ where: { businessId } }),
    prisma.businessHours.deleteMany({ where: { businessId } }),
    prisma.blockedTime.deleteMany({ where: { businessId } }),
    prisma.faqEntry.deleteMany({ where: { businessId } }),
    prisma.googleCalendarToken.deleteMany({ where: { businessId } }),
    prisma.conversationMessage.deleteMany({ where: { businessId } }),
    prisma.apiUsageEvent.deleteMany({ where: { businessId } }),
    prisma.passwordResetToken.deleteMany({ where: { businessId } }),
    prisma.business.delete({ where: { id: businessId } }),
  ]);
  console.log(`[admin] Business ${businessId} (${business.name}) permanently deleted by super admin`);
  await logAdminAction({
    actorEmail: process.env.SUPER_ADMIN_EMAIL!,
    action: "delete",
    targetBusinessId: businessId,
    targetBusinessName: business.name,
  });
  res.json({ ok: true });
});

// Support impersonation: a short-lived token (1h) that logs the admin panel's client straight
// into a business's own dashboard, exactly as they see it, without knowing their password.
businessRouter.post("/admin/businesses/:id/impersonate", requireSuperAdmin, async (req: AuthedRequest, res) => {
  const business = await prisma.business.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
  if (!business) return res.status(404).json({ error: "Not found" });

  const adminEmail = process.env.SUPER_ADMIN_EMAIL!;
  const token = signImpersonationToken(business.id, adminEmail);
  await logAdminAction({
    actorEmail: adminEmail,
    action: "impersonate",
    targetBusinessId: business.id,
    targetBusinessName: business.name,
  });
  res.json({ token });
});

// Recent admin actions across all businesses — the audit trail for block/unblock/plan/delete/
// impersonate. Not scoped by businessId by default so it reads as one operator timeline; pass
// ?businessId= to see just one business's history.
businessRouter.get("/admin/audit-log", requireSuperAdmin, async (req: AuthedRequest, res) => {
  const businessId = req.query.businessId as string | undefined;
  const entries = await prisma.adminAuditLog.findMany({
    where: businessId ? { targetBusinessId: businessId } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(entries);
});

// Daily MRR/status-count history for the trend chart — populated by metricSnapshotJob.ts.
businessRouter.get("/admin/mrr-history", requireSuperAdmin, async (_req: AuthedRequest, res) => {
  const snapshots = await prisma.businessMetricSnapshot.findMany({
    orderBy: { date: "asc" },
    take: 90,
  });
  res.json(snapshots);
});

// Sends a one-off WhatsApp warning/notice to the business's own registered number (not their
// customers) — e.g. "please update billing" before actually blocking the account.
const adminMessageSchema = z.object({ text: z.string().min(1).max(1000) });
businessRouter.post("/admin/businesses/:id/message", requireSuperAdmin, async (req: AuthedRequest, res) => {
  const parsed = adminMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const business = await prisma.business.findUnique({
    where: { id: req.params.id },
    select: { name: true, email: true, whatsappPhoneNumberId: true, whatsappAccessToken: true, notificationPhone: true },
  });
  if (!business) return res.status(404).json({ error: "Not found" });

  if (business.whatsappPhoneNumberId && business.whatsappAccessToken && business.notificationPhone) {
    const accessToken = decryptSecret(business.whatsappAccessToken);
    await sendWhatsAppMessage({
      phoneNumberId: business.whatsappPhoneNumberId,
      accessToken,
      to: business.notificationPhone,
      text: parsed.data.text,
    });
    return res.json({ ok: true, channel: "whatsapp" });
  }

  await sendBusinessNoticeEmail(business.email, business.name, parsed.data.text);
  res.json({ ok: true, channel: "email" });
});

// White-glove WhatsApp onboarding: connect a WhatsApp number to a business ON THEIR BEHALF, for
// salon owners who have no Facebook account (WhatsApp's Cloud API always needs a Meta Business
// Account somewhere in the chain, but it doesn't have to be theirs — you register the number
// under a Tori-controlled Business Manager and paste the resulting phoneNumberId + permanent
// token here). Validates against Meta before saving so a bad token surfaces immediately instead
// of silently at the first message send.
const adminWhatsappSchema = z.object({
  phoneNumberId: z.string().min(1),
  accessToken: z.string().min(1),
});
businessRouter.post("/admin/businesses/:id/whatsapp", requireSuperAdmin, async (req: AuthedRequest, res) => {
  const parsed = adminWhatsappSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const business = await prisma.business.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, voicePhoneNumber: true } });
  if (!business) return res.status(404).json({ error: "Not found" });

  // Verify the token can actually read this phone number before persisting — catches a typo'd id,
  // an expired token, or a token scoped to a different WABA.
  let displayNumber: string | undefined;
  try {
    const verifyRes = await fetch(
      `https://graph.facebook.com/v23.0/${parsed.data.phoneNumberId}?fields=display_phone_number&access_token=${encodeURIComponent(parsed.data.accessToken)}`
    );
    const verifyData = (await verifyRes.json()) as any;
    if (verifyData?.error) {
      return res.status(400).json({ error: `Meta rejected these credentials: ${verifyData.error.message}` });
    }
    displayNumber = verifyData?.display_phone_number;
  } catch (err) {
    return res.status(502).json({ error: "Could not reach Meta to verify credentials — try again." });
  }

  try {
    await prisma.business.update({
      where: { id: business.id },
      data: {
        whatsappPhoneNumberId: parsed.data.phoneNumberId,
        whatsappAccessToken: encryptSecret(parsed.data.accessToken),
        whatsappTokenValid: true,
        ...(!business.voicePhoneNumber && displayNumber ? { voicePhoneNumber: displayNumber } : {}),
      },
    });
  } catch (err: any) {
    if (err?.code !== "P2002") throw err;
    await prisma.business.update({
      where: { id: business.id },
      data: { whatsappPhoneNumberId: parsed.data.phoneNumberId, whatsappAccessToken: encryptSecret(parsed.data.accessToken), whatsappTokenValid: true },
    });
  }
  await logAdminAction({
    actorEmail: process.env.SUPER_ADMIN_EMAIL!,
    action: "connect_whatsapp",
    targetBusinessId: business.id,
    targetBusinessName: business.name,
    details: `Connected WhatsApp on their behalf (${displayNumber ?? parsed.data.phoneNumberId})`,
  });
  res.json({ ok: true, displayNumber });
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
  depositEnabled: z.boolean().optional(),
  depositAmountIls: z.number().int().nonnegative().max(100000).optional(),
  depositHoldMinutes: z.number().int().min(5).max(1440).optional(),
  availabilityInfo: z.string().max(600).optional(),
  aiProvider: z.enum(AI_PROVIDER_KEYS).optional(),
  aiModel: z.string().max(100).nullable().optional(),
});

// Display metadata for the Bot page's provider/model picker — which providers are actually
// configured with an API key on this server (so the UI can warn before an owner picks one that
// will just fail at send time), plus the default cheap/smart model ids for each.
businessRouter.get("/me/ai-providers", async (_req: AuthedRequest, res) => {
  res.json({
    providers: [
      { key: "anthropic", label: "Claude (Anthropic)", configured: Boolean(process.env.ANTHROPIC_API_KEY), defaultModels: ["claude-haiku-4-5-20251001", "claude-sonnet-5"] },
      { key: "openai", label: "OpenAI (GPT)", configured: Boolean(process.env.OPENAI_API_KEY), defaultModels: ["gpt-4o-mini", "gpt-4o"] },
      // deepseek-reasoner is intentionally not offered — it does not support function calling,
      // which this bot depends on entirely. See bot/providers/index.ts.
      { key: "deepseek", label: "DeepSeek", configured: Boolean(process.env.DEEPSEEK_API_KEY), defaultModels: ["deepseek-chat"] },
    ],
  });
});

businessRouter.put("/me", async (req: AuthedRequest, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await prisma.business.update({ where: { id: req.businessId! }, data: parsed.data });
  res.json({ ok: true });
});

// --- Category templates (vertical onboarding) ---

// Lists the selectable categories for the onboarding picker — display metadata only, no secrets.
businessRouter.get("/me/templates", async (_req: AuthedRequest, res) => {
  res.json({
    templates: listTemplates().map((t) => ({
      type: t.type,
      emoji: t.emoji,
      labelHe: t.labelHe,
      labelEn: t.labelEn,
      descriptionHe: t.descriptionHe,
      depositEnabled: t.presets.depositEnabled,
      depositAmountIls: t.presets.depositAmountIls,
      reviewsEnabled: t.presets.reviewsEnabled,
      sampleServices: t.seedServices.map((s) => s.name),
    })),
  });
});

// --- Setup progress (onboarding checklist) ---

/**
 * Reports which first-run setup steps are done, so the dashboard can show a progress checklist and
 * warn about the ones that silently break the product — most importantly notificationPhone: without
 * it the owner never hears about new bookings or human-handoff requests, and the bot can even tell
 * a customer "someone will call you back" when nobody was actually alerted.
 */
businessRouter.get("/me/setup-status", async (req: AuthedRequest, res) => {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! } });
  const [serviceCount, hoursCount] = await Promise.all([
    prisma.service.count({ where: { businessId: business.id } }),
    prisma.businessHours.count({ where: { businessId: business.id } }),
  ]);

  const steps = [
    { key: "category", done: Boolean(business.businessTypeChosenAt), critical: false },
    { key: "whatsapp", done: Boolean(business.whatsappAccessToken) && business.whatsappTokenValid, critical: true },
    { key: "notificationPhone", done: Boolean(business.notificationPhone?.trim()), critical: true },
    { key: "services", done: serviceCount > 0, critical: true },
    { key: "hours", done: hoursCount > 0, critical: true },
  ];

  res.json({
    steps,
    complete: steps.every((s) => s.done),
    doneCount: steps.filter((s) => s.done).length,
    totalCount: steps.length,
    botEnabled: business.botEnabled,
  });
});

// Business-wide bot on/off switch (holiday, emergency, "I'll answer manually today").
businessRouter.put("/me/bot-enabled", async (req: AuthedRequest, res) => {
  const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await prisma.business.update({ where: { id: req.businessId! }, data: { botEnabled: parsed.data.enabled } });
  res.json({ ok: true, botEnabled: parsed.data.enabled });
});

/**
 * Sends a test WhatsApp message from the business's own number to a phone of their choosing
 * (defaults to their notification phone), so an owner can prove the connection works without
 * guessing. Note this only proves OUTBOUND sending; replies still depend on the webhook.
 */
businessRouter.post("/me/whatsapp/test-message", async (req: AuthedRequest, res) => {
  const parsed = z.object({ to: z.string().min(6).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! } });
  if (!business.whatsappPhoneNumberId || !business.whatsappAccessToken) {
    return res.status(400).json({ error: "Connect a WhatsApp number first" });
  }
  const to = parsed.data.to?.trim() || business.notificationPhone?.trim();
  if (!to) return res.status(400).json({ error: "No phone number to send to — set your notification phone first" });

  try {
    await sendWhatsAppMessage({
      phoneNumberId: business.whatsappPhoneNumberId,
      accessToken: decryptSecret(business.whatsappAccessToken),
      to,
      text: `✅ בדיקה מתורי — החיבור לוואטסאפ של "${business.name}" עובד. אם קיבלת את ההודעה הזו, שליחת ההודעות מוגדרת כמו שצריך.`,
    });
    res.json({ ok: true, to });
  } catch (err) {
    // Meta's own message is the useful part here (e.g. "24h window", bad number) — surface it.
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to send test message" });
  }
});

const applyTemplateSchema = z.object({ type: z.enum(BUSINESS_TYPES) });

// Applies a category template: sets businessType and pre-fills untouched settings + seed services.
businessRouter.post("/me/apply-template", async (req: AuthedRequest, res) => {
  const parsed = applyTemplateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const result = await applyTemplate(req.businessId!, parsed.data.type);
  res.json({ ok: true, ...result });
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

// Voice bot phone number — the Cartesia-provisioned number this salon's calls come in on. Just a
// lookup key (unlike WhatsApp, no token to store here: Cartesia holds the call, our server only
// answers its tool calls — see voiceRoutes.ts).
businessRouter.put("/me/voice-phone", async (req: AuthedRequest, res) => {
  const parsed = z.object({ voicePhoneNumber: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    await prisma.business.update({ where: { id: req.businessId! }, data: { voicePhoneNumber: parsed.data.voicePhoneNumber } });
  } catch (err: any) {
    if (err?.code === "P2002") return res.status(409).json({ error: "This number is already connected to another business" });
    throw err;
  }
  res.json({ ok: true });
});

businessRouter.delete("/me/voice-phone", async (req: AuthedRequest, res) => {
  await prisma.business.update({ where: { id: req.businessId! }, data: { voicePhoneNumber: null } });
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
  let wabaId = business.whatsappWabaId ?? undefined;
  if (!wabaId) {
    try {
      wabaId = await getWabaId(business.whatsappPhoneNumberId, accessToken);
    } catch (err) {
      return res.status(502).json({ error: err instanceof Error ? err.message : "Could not resolve WhatsApp Business Account" });
    }
    await prisma.business.update({ where: { id: business.id }, data: { whatsappWabaId: wabaId } });
  }

  const reminder = reminderTemplate();
  const review = reviewTemplate();
  const results: CreateTemplateResult[] = await Promise.all([
    createMessageTemplate(wabaId, accessToken, { name: reminder.name, languageCode: reminder.languageCode, bodyText: REMINDER_TEMPLATE_BODY }),
    createMessageTemplate(wabaId, accessToken, { name: review.name, languageCode: review.languageCode, bodyText: REVIEW_TEMPLATE_BODY }),
  ]);
  res.json({ results });
});

// Sets the WhatsApp Business Profile picture — the avatar customers see next to the bot's
// messages. Accepts a data: URL (image already resized/compressed client-side) rather than a
// multipart upload, matching every other endpoint on this router, which are all JSON.
const MAX_PROFILE_PICTURE_BYTES = 5 * 1024 * 1024;
const profilePictureSchema = z.object({ imageBase64: z.string().min(1) });
businessRouter.post("/me/whatsapp/profile-picture", async (req: AuthedRequest, res) => {
  const parsed = profilePictureSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! } });
  if (!business.whatsappPhoneNumberId || !business.whatsappAccessToken) {
    return res.status(400).json({ error: "Connect a WhatsApp number first" });
  }
  const appId = process.env.META_APP_ID;
  if (!appId) return res.status(500).json({ error: "Server not configured for WhatsApp profile uploads" });

  const dataUrlMatch = parsed.data.imageBase64.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);
  const mimeType = dataUrlMatch ? dataUrlMatch[1] : "image/jpeg";
  const rawBase64 = dataUrlMatch ? dataUrlMatch[2] : parsed.data.imageBase64;

  let imageBuffer: Buffer;
  try {
    imageBuffer = Buffer.from(rawBase64, "base64");
  } catch {
    return res.status(400).json({ error: "Invalid image data" });
  }
  if (imageBuffer.length === 0) return res.status(400).json({ error: "Invalid image data" });
  if (imageBuffer.length > MAX_PROFILE_PICTURE_BYTES) return res.status(400).json({ error: "Image too large (max 5MB)" });

  const accessToken = decryptSecret(business.whatsappAccessToken);
  try {
    await setWhatsAppProfilePicture({ phoneNumberId: business.whatsappPhoneNumberId, accessToken, appId, imageBuffer, mimeType });
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Failed to set profile picture" });
  }
  res.json({ ok: true });
});

// --- Payment provider (PayPlus / Tranzila / Cardcom / Grow / Tori-managed) — the business's own
// merchant account, except "tori_managed" which uses Tori's own account for a surcharge ---

// NOTE: "tori_managed" is intentionally NOT accepted for *payments*. Running card processing for
// other businesses through Tori's own PayPlus merchant account is third-party clearing, which
// PayPlus's contract forbids and which exposes Tori to anti-money-laundering liability, tax
// misreporting (all volume reported under Tori's ח.פ.), and 100% of the chargeback risk. Every
// salon must connect its own merchant account. (The tori_managed *invoice* path is a separate
// decision handled below.) A proper managed offering would require a PayPlus Marketplace/Split
// Payments contract with per-salon KYC — not this shared-account shortcut.
const paymentConnectSchema = z
  .object({
    provider: z.enum(PAYMENT_PROVIDERS).refine((p) => p !== "tori_managed", {
      message: "Managed payment clearing is not available — connect your own merchant account.",
    }),
    apiKey: z.string().min(1).optional(),
    apiSecret: z.string().min(1).optional(),
  })
  .refine((v) => v.apiKey && v.apiSecret, {
    message: "apiKey and apiSecret are required for this provider",
  });

businessRouter.put("/me/payment-provider", async (req: AuthedRequest, res) => {
  const parsed = paymentConnectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const provider = getPaymentProvider(parsed.data.provider);
  const creds = { apiKey: parsed.data.apiKey ?? "", apiSecret: parsed.data.apiSecret ?? "" };
  const verification = await provider.verifyCredentials(creds);
  if (!verification.valid) return res.status(400).json({ error: verification.error ?? "Invalid credentials" });

  // Generate the webhook secret once, on first connect — reused across reconnects/provider
  // switches so the URL already configured in the provider's dashboard keeps working. Only a
  // business that has never connected a provider before gets a fresh one.
  const existing = await prisma.business.findUnique({ where: { id: req.businessId! }, select: { paymentWebhookSecret: true } });
  const webhookSecret = existing?.paymentWebhookSecret ?? crypto.randomBytes(24).toString("hex");

  await prisma.business.update({
    where: { id: req.businessId! },
    data: {
      paymentProvider: parsed.data.provider,
      paymentApiKey: encryptSecret(parsed.data.apiKey!),
      paymentApiSecret: encryptSecret(parsed.data.apiSecret!),
      paymentWebhookSecret: webhookSecret,
    },
  });
  res.json({ ok: true, webhookSecret });
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

// NOTE: "tori_managed" is intentionally NOT accepted here either, same reasoning as managed
// *payment* clearing above: issuing invoices/receipts under Tori's own tax ID for a sale that was
// actually made by a different business is the same kind of misattribution risk (could read as
// falsified accounting documents, and creates a real mess for the salon's own bookkeeping/tax
// filing since the documents wouldn't be under their own ח.פ.). "payplus-invoice" alone still
// needs no business-supplied apiKey/apiSecret since it reuses their own PayPlus payment credentials.
const NO_KEYS_NEEDED = new Set(["payplus-invoice"]);
const invoiceConnectSchema = z
  .object({
    provider: z.enum(INVOICE_PROVIDERS).refine((p) => p !== "tori_managed", {
      message: "Managed invoicing is not available — connect your own invoicing provider.",
    }),
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

// Embedded Signup: FB.login runs with response_type: "code" (Meta's currently documented flow for
// WhatsApp Embedded Signup — the older implicit response_type: "token" flow silently falls back to
// a plain Facebook login instead of routing through the WABA/phone-number selection UI, which is
// why waba_id/phone_number_id and the WA_EMBEDDED_SIGNUP postMessage never showed up before this).
// The short-lived code from the popup must be exchanged server-side (needs the app secret) for a
// real user access token before any of the phone-number lookups below can run.
async function exchangeCodeForAccessToken(code: string): Promise<string> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET; // same Meta app as the WhatsApp webhook signature secret
  if (!appId || !appSecret) throw new Error("META_APP_ID/WHATSAPP_APP_SECRET not configured");

  // No redirect_uri: Meta's own generated Embedded Signup link for this config_id doesn't include
  // one, confirming this flow doesn't use it. Every earlier "redirect_uri is identical" failure
  // (error_subcode 36008) was actually caused by using the wrong config_id on the frontend — a
  // generic Facebook Login for Business config instead of the one tied to the WhatsApp use case
  // (App Dashboard > WhatsApp use case > Become a Partner > Embedded Signup Builder).
  const url = `https://graph.facebook.com/v23.0/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`;
  const res = await fetch(url);
  const data = (await res.json()) as any;
  if (data?.error || !data?.access_token) {
    // Log Meta's full error object (type/code/error_subcode/fbtrace_id) — the message alone is a
    // generic, reused string across several distinct underlying causes and isn't enough to diagnose.
    console.error("[embedded-signup] Full Graph API error response:", JSON.stringify(data));
    throw new Error(`Code exchange failed: ${data?.error?.message ?? "no access_token in response"}`);
  }
  return data.access_token as string;
}

businessRouter.post("/me/whatsapp/embedded-signup", async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ code: z.string().min(1), wabaId: z.string().optional(), phoneNumberId: z.string().optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Missing code" });

  let userToken: string;
  try {
    userToken = await exchangeCodeForAccessToken(parsed.data.code);
  } catch (err) {
    console.error("[embedded-signup] Code exchange failed:", err);
    return res.status(502).json({ error: err instanceof Error ? err.message : "Code exchange failed" });
  }

  let phone: { id: string; display_phone_number: string } | undefined;
  let wabaId: string | undefined;
  const debugTrail: Record<string, unknown> = {};

  // Primary path: the waba_id/phone_number_id Meta posts to the frontend via the
  // WA_EMBEDDED_SIGNUP postMessage event during the signup flow itself — the documented,
  // reliable source. Prefer these over any Graph API reconstruction attempted afterward, which
  // depends on permissions/scopes that turned out not to be consistently granted.
  if (parsed.data.phoneNumberId) {
    const phoneRes = await fetch(
      `https://graph.facebook.com/v23.0/${parsed.data.phoneNumberId}?fields=id,display_phone_number&access_token=${encodeURIComponent(userToken)}`
    );
    const phoneData = await phoneRes.json() as any;
    debugTrail.postMessagePhone = phoneData?.error ?? "ok";
    if (phoneData?.id) {
      phone = { id: phoneData.id, display_phone_number: phoneData.display_phone_number };
      wabaId = parsed.data.wabaId;
    }
  }

  // Fallback 1b: Meta's FINISH_ONLY_WABA postMessage event fires a waba_id with no
  // phone_number_id when the user picked/created a WhatsApp Business Account but the popup closed
  // before (or without) them confirming a phone number on it. Rather than immediately falling
  // through to scope-reconstruction below, check the WABA directly — a phone number may already
  // exist on it (added slightly after the event fired) even though this specific event didn't
  // carry its id.
  if (!phone && parsed.data.wabaId) {
    const phoneRes = await fetch(
      `https://graph.facebook.com/v23.0/${parsed.data.wabaId}/phone_numbers?fields=id,display_phone_number&access_token=${encodeURIComponent(userToken)}`
    );
    const phoneData = await phoneRes.json() as any;
    debugTrail.wabaDirect = phoneData?.error ?? `found ${phoneData?.data?.length ?? 0} numbers`;
    if (phoneData?.data?.[0]?.id) {
      phone = phoneData.data[0];
      wabaId = parsed.data.wabaId;
    }
  }

  // Fallback 2: debug_token → granular_scopes. Discovers which WABAs the user granted during
  // signup without needing business_management — works when the postMessage above didn't fire
  // (e.g. an ad/popup blocker interfering) but the login itself still succeeded.
  if (!phone) {
    const debugRes = await fetch(
      `https://graph.facebook.com/v23.0/debug_token?input_token=${encodeURIComponent(userToken)}&access_token=${encodeURIComponent(userToken)}`
    );
    const debugData = await debugRes.json() as any;
    debugTrail.debugToken = debugData?.error ?? "ok";
    const granted: { scope: string; target_ids?: string[] }[] = debugData?.data?.granular_scopes ?? [];
    const wabaIds: string[] =
      granted.find((s) => s.scope === "whatsapp_business_management")?.target_ids ??
      granted.find((s) => s.scope === "whatsapp_business_messaging")?.target_ids ?? [];

    for (const id of wabaIds) {
      const phoneRes = await fetch(
        `https://graph.facebook.com/v23.0/${id}/phone_numbers?fields=id,display_phone_number&access_token=${encodeURIComponent(userToken)}`
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

  // Fallback 3: me/businesses (works only if the token also has business_management — kept for
  // manually-created tokens pasted through this endpoint, not the Embedded Signup flow).
  if (!phone) {
    const bizRes = await fetch(
      `https://graph.facebook.com/v23.0/me/businesses?fields=owned_whatsapp_business_accounts{id,phone_numbers{id,display_phone_number}}&access_token=${encodeURIComponent(userToken)}`
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

  // wabaId isn't always known at this point — the primary (postMessage) path only ever sets it
  // to whatever the frontend happened to capture, which can be undefined even when a phone number
  // was found. Resolve it from the phone number itself rather than silently skipping the
  // subscription below: a connection that never subscribes the app to the WABA's webhook events
  // looks fully "connected" in the dashboard (valid token, phone number stored) but the bot will
  // never receive a single incoming message.
  if (!wabaId) {
    try {
      wabaId = await getWabaId(phone.id, userToken);
    } catch (err) {
      console.error("[embedded-signup] Could not resolve WABA id for subscription:", err);
    }
  }

  const subscribed = wabaId ? await subscribeAppToWaba(wabaId, userToken) : false;
  if (!subscribed) {
    captureError(new Error("WhatsApp embedded-signup: app subscription to WABA failed or wabaId unresolved"), {
      businessId: req.businessId, wabaId, phoneNumberId: phone.id,
    });
  }

  // Final activation step: without /register, the number stays "Pending" — verified and
  // subscribed, but silent. Reuse the business's existing PIN if one was ever set (Meta rejects
  // a different PIN once two-step verification is on). Skip if already registered — Meta
  // rate-limits registration attempts (133016), so we never re-register a working number.
  const existing = await prisma.business.findUniqueOrThrow({
    where: { id: req.businessId! },
    select: { whatsappRegistrationPin: true, whatsappRegisteredAt: true, whatsappPhoneNumberId: true, voicePhoneNumber: true },
  });
  const pin = existing.whatsappRegistrationPin ?? generateRegistrationPin();
  const alreadyRegistered = existing.whatsappRegisteredAt !== null && existing.whatsappPhoneNumberId === phone.id;
  let registeredAt = existing.whatsappRegisteredAt;
  if (!alreadyRegistered) {
    const registration = await registerPhoneNumber(phone.id, userToken, pin);
    if (registration.ok) {
      registeredAt = new Date();
    } else {
      captureError(new Error(`WhatsApp embedded-signup: phone registration failed: ${registration.error}`), {
        businessId: req.businessId, phoneNumberId: phone.id,
      });
    }
  }

  try {
    await prisma.business.update({
      where: { id: req.businessId! },
      data: {
        whatsappPhoneNumberId: phone.id,
        whatsappAccessToken: encryptSecret(userToken),
        whatsappTokenValid: true,
        whatsappRegistrationPin: pin,
        whatsappRegisteredAt: registeredAt,
        ...(wabaId ? { whatsappWabaId: wabaId } : {}),
        // Most salons want one number for both channels — default the voice bot to the same number
        // they just connected on WhatsApp, but only the first time: never override a number the
        // owner already set manually via PUT /me/voice-phone.
        ...(!existing.voicePhoneNumber && phone.display_phone_number ? { voicePhoneNumber: phone.display_phone_number } : {}),
      },
    });
  } catch (err: any) {
    // voicePhoneNumber is unique — in the rare case another business already claimed this exact
    // number as their voice line, retry without it rather than failing the whole WhatsApp connect.
    if (err?.code === "P2002") {
      await prisma.business.update({
        where: { id: req.businessId! },
        data: {
          whatsappPhoneNumberId: phone.id,
          whatsappAccessToken: encryptSecret(userToken),
          whatsappTokenValid: true,
          whatsappRegistrationPin: pin,
          whatsappRegisteredAt: registeredAt,
          ...(wabaId ? { whatsappWabaId: wabaId } : {}),
        },
      });
    } else {
      throw err;
    }
  }

  res.json({ ok: true, phoneNumber: phone.display_phone_number, subscribed });
});

// Read-only health check: asks Meta directly for the number's live status and the WABA's
// subscribed apps, so we can see whether a number that looks "connected" on our side is actually
// registered + live on Meta's side (an unregistered/PENDING number silently receives no webhooks).
businessRouter.get("/me/whatsapp/diagnostics", async (req: AuthedRequest, res) => {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! } });
  if (!business.whatsappPhoneNumberId || !business.whatsappAccessToken) {
    return res.status(400).json({ error: "Connect a WhatsApp number first" });
  }
  const accessToken = decryptSecret(business.whatsappAccessToken);
  const phoneStatus = await getPhoneNumberStatus(business.whatsappPhoneNumberId, accessToken);

  let wabaId = business.whatsappWabaId ?? undefined;
  if (!wabaId) {
    try { wabaId = await getWabaId(business.whatsappPhoneNumberId, accessToken); } catch { /* leave undefined */ }
  }
  const subscribedApps = wabaId ? await getSubscribedApps(wabaId, accessToken) : { apps: [], error: "no WABA id" };

  res.json({
    ourRecord: {
      phoneNumberId: business.whatsappPhoneNumberId,
      wabaId: wabaId ?? null,
      tokenValid: business.whatsappTokenValid,
      registeredAt: business.whatsappRegisteredAt,
      appId: process.env.META_APP_ID ?? null,
      // The webhook drops every inbound message unless this is "trial"/"active" and the account
      // isn't blocked — a silent failure mode that looks identical to "not connected".
      subscriptionStatus: business.subscriptionStatus,
      blocked: Boolean(business.blockedAt),
      // When the last /register attempt was made and the earliest safe retry (last + 72h), so the
      // Meta 133016 rolling lockout can be waited out instead of endlessly reset.
      lastRegisterAttempt: business.whatsappRegisterAttemptedAt,
      registerRetryAfter: business.whatsappRegisterAttemptedAt
        ? new Date(business.whatsappRegisterAttemptedAt.getTime() + 72 * 60 * 60 * 1000)
        : null,
      webhookWillProcess:
        !business.blockedAt && ["trial", "active"].includes(business.subscriptionStatus),
      // Whether Meta's app-secret signature check is even enforced on this deploy.
      appSecretConfigured: Boolean(process.env.WHATSAPP_APP_SECRET),
    },
    metaPhoneStatus: phoneStatus,
    metaSubscribedApps: subscribedApps,
  });
});

// Re-subscribes this business's own app to its WABA's webhook events, using the access token
// already on file — no new Meta login required. Exists because the subscription step above can
// fail (or, before this fix, silently skip) without it being visible anywhere: the business shows
// as "connected" (valid token, phone number saved) but the bot never receives incoming messages,
// since Meta only pushes webhook events to apps explicitly subscribed to that WABA.
businessRouter.post("/me/whatsapp/resubscribe", async (req: AuthedRequest, res) => {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.businessId! } });
  if (!business.whatsappPhoneNumberId || !business.whatsappAccessToken) {
    return res.status(400).json({ error: "Connect a WhatsApp number first" });
  }
  const accessToken = decryptSecret(business.whatsappAccessToken);

  let wabaId = business.whatsappWabaId ?? undefined;
  if (!wabaId) {
    try {
      wabaId = await getWabaId(business.whatsappPhoneNumberId, accessToken);
    } catch (err) {
      return res.status(502).json({ error: err instanceof Error ? err.message : "Could not resolve WhatsApp Business Account" });
    }
    // Backfill so future resubscribes skip this lookup entirely.
    await prisma.business.update({ where: { id: business.id }, data: { whatsappWabaId: wabaId } });
  }

  const subscribed = await subscribeAppToWaba(wabaId, accessToken);
  if (!subscribed) {
    return res.status(502).json({ error: "Meta rejected the subscription request — see server logs for details" });
  }

  // Register the number to the Cloud API only if it has never been registered — an unregistered
  // number is the other silent failure mode with these symptoms (everything shows connected, bot
  // hears nothing). Crucially, do NOT re-register an already-registered number: Meta rate-limits
  // registration attempts hard (133016), and repeated "Fix connection" clicks would otherwise
  // trip that lockout. Subscription (above) is the safe, idempotent part to repeat.
  if (!business.whatsappRegisteredAt) {
    // Meta's 133016 lockout is a rolling 72h window that every attempt restarts. Refuse to attempt
    // again within 72h of the last try so the lockout can actually expire instead of resetting.
    const COOLDOWN_MS = 72 * 60 * 60 * 1000;
    const lastAttempt = business.whatsappRegisterAttemptedAt?.getTime();
    if (lastAttempt && Date.now() - lastAttempt < COOLDOWN_MS) {
      const readyAt = new Date(lastAttempt + COOLDOWN_MS);
      return res.status(429).json({
        error: `WhatsApp blocked new registration attempts for this number (Meta error 133016). To let the block expire you must not retry until ${readyAt.toISOString().slice(0, 16).replace("T", " ")} UTC. Every earlier attempt reset this 72-hour clock.`,
      });
    }
    const pin = business.whatsappRegistrationPin ?? generateRegistrationPin();
    const registration = await registerPhoneNumber(business.whatsappPhoneNumberId, accessToken, pin);
    if (!registration.ok) {
      await prisma.business.update({
        where: { id: business.id },
        data: { whatsappRegistrationPin: pin, whatsappRegisterAttemptedAt: new Date() },
      });
      return res.status(502).json({ error: `Phone registration failed: ${registration.error}` });
    }
    await prisma.business.update({
      where: { id: business.id },
      data: { whatsappRegistrationPin: pin, whatsappRegisteredAt: new Date(), whatsappRegisterAttemptedAt: new Date() },
    });
  }
  res.json({ ok: true });
});

// --- Services ---

const serviceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  priceCents: z.number().int().nonnegative(),
  durationMin: z.number().int().positive(),
  color: z.string().optional(),
  capacity: z.number().int().min(1).max(500).optional(), // >1 = group class; omitted keeps default 1
  imageUrl: z.string().optional(),
  linkUrl: z.string().optional(),
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

  // Notify waitlist and clean up the calendar event after responding so the HTTP request isn't delayed
  notifyWaitlist(req.businessId!, appointment.serviceId, appointment.service.name, appointment.startTime).catch(
    (err) => console.error("[waitlist] Notification failed:", err)
  );
  if (appointment.calendarEventId) {
    deleteCalendarEvent(req.businessId!, appointment.calendarEventId).catch((err) => console.error("Calendar event delete failed:", err));
  }
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

  // Persist to the shared transcript (previously only shown optimistically client-side and lost
  // on reload — worse, the bot's own context via getHistory never learned this message existed).
  // Sending a manual message also means a human is now handling this thread, so pause the bot
  // here automatically rather than requiring a separate toggle — it can be resumed explicitly.
  await appendTurn(req.businessId!, customer.phone, { role: "assistant", content: parsed.data.text });
  if (!customer.botPaused) {
    await prisma.customer.update({ where: { id: customer.id }, data: { botPaused: true, botPausedAt: new Date() } });
  }

  res.json({ ok: true, botPaused: true });
});

businessRouter.patch("/customers/:id/bot-paused", async (req: AuthedRequest, res) => {
  const parsed = z.object({ paused: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const customer = await prisma.customer.findFirst({ where: { id: req.params.id, businessId: req.businessId! } });
  if (!customer) return res.status(404).json({ error: "Not found" });

  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: { botPaused: parsed.data.paused, botPausedAt: parsed.data.paused ? new Date() : null },
  });
  res.json({ botPaused: updated.botPaused });
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
