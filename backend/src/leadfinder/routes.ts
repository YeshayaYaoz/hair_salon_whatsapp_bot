import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { requireSuperAdmin } from "../api/businessRoutes.js";
import { executeLeadFinderRun } from "./runner.js";
import { loadScoringWeights, DEFAULT_SCORING_CONFIG_KEY } from "./scoring.js";
import { APP_URL, sendTrialAccountCreatedEmail } from "../lib/email.js";
import { nameSimilarity } from "./matching.js";
import { generateOutreachDraft } from "./outreach.js";
import { sendWhatsAppTemplate } from "../webhook/whatsappClient.js";
import { sendOutreachEmail } from "../lib/email.js";

export const leadFinderRouter = Router();

// Every Lead Finder route is a super-admin-only internal tool — reuse the exact same auth
// middleware as the rest of the admin surface rather than duplicating it.
leadFinderRouter.use(requireAuth);
leadFinderRouter.use(requireSuperAdmin);

const LEAD_STATUSES = [
  "new",
  "contacted",
  "replied",
  "meeting_scheduled",
  "trial_sent",
  "converted",
  "not_interested",
] as const;

const createCampaignSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  locationQuery: z.string().min(1),
});

const updateStatusSchema = z.object({
  status: z.enum(LEAD_STATUSES),
  note: z.string().optional(),
});

const scoringConfigSchema = z.object({
  weights: z.record(z.string(), z.number()),
});

// --- Campaigns ---

leadFinderRouter.post("/campaigns", async (req: AuthedRequest, res) => {
  const parsed = createCampaignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const campaign = await prisma.leadCampaign.create({ data: parsed.data });
  res.status(201).json(campaign);
});

leadFinderRouter.get("/campaigns", async (_req: AuthedRequest, res) => {
  const campaigns = await prisma.leadCampaign.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { leads: true } } },
  });
  res.json(campaigns);
});

leadFinderRouter.get("/campaigns/:id", async (req: AuthedRequest, res) => {
  const campaign = await prisma.leadCampaign.findUnique({
    where: { id: req.params.id },
    include: { runs: { orderBy: { createdAt: "desc" } }, _count: { select: { leads: true } } },
  });
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });
  res.json(campaign);
});

const updateCampaignSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  locationQuery: z.string().min(1).optional(),
  status: z.enum(["draft", "running", "paused", "completed"]).optional(),
});
leadFinderRouter.patch("/campaigns/:id", async (req: AuthedRequest, res) => {
  const parsed = updateCampaignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const campaign = await prisma.leadCampaign.update({ where: { id: req.params.id }, data: parsed.data }).catch(() => null);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });
  res.json(campaign);
});

// Deletes a campaign and everything scoped to it. LeadScore/LeadProfile/LeadStatusEvent/
// OutreachMessage/ConsentLog all cascade off Lead at the DB level (onDelete: Cascade), so deleting
// the leads is enough to take those with them; LeadFinderRun and the campaign itself don't have a
// cascade (deliberately, same reasoning as the Business delete above) so they're explicit here.
leadFinderRouter.delete("/campaigns/:id", async (req: AuthedRequest, res) => {
  const campaignId = req.params.id;
  const campaign = await prisma.leadCampaign.findUnique({ where: { id: campaignId }, select: { id: true } });
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  await prisma.$transaction([
    prisma.lead.deleteMany({ where: { campaignId } }),
    prisma.leadFinderRun.deleteMany({ where: { campaignId } }),
    prisma.leadCampaign.delete({ where: { id: campaignId } }),
  ]);
  res.json({ ok: true });
});

// --- Runs ---

leadFinderRouter.post("/campaigns/:id/runs", async (req: AuthedRequest, res) => {
  const campaign = await prisma.leadCampaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  const run = await prisma.leadFinderRun.create({
    data: { campaignId: campaign.id, status: "pending" },
  });
  await prisma.leadCampaign.update({ where: { id: campaign.id }, data: { status: "running" } });

  // Fire-and-forget: the UI polls GET /runs/:id for progress rather than waiting on this
  // request. Any failure inside is caught and recorded on the run row by executeLeadFinderRun
  // itself, so we don't need a .catch() here beyond a defensive log.
  executeLeadFinderRun(run.id).catch((err) => console.error(`[leadfinder] Unhandled run error for ${run.id}:`, err));

  res.status(202).json({ runId: run.id });
});

leadFinderRouter.get("/runs/:id", async (req: AuthedRequest, res) => {
  const run = await prisma.leadFinderRun.findUnique({ where: { id: req.params.id } });
  if (!run) return res.status(404).json({ error: "Run not found" });
  res.json(run);
});

// --- Leads ---

leadFinderRouter.get("/campaigns/:id/leads", async (req: AuthedRequest, res) => {
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const leads = await prisma.lead.findMany({
    where: { campaignId: req.params.id, ...(statusFilter ? { status: statusFilter } : {}) },
    include: {
      scores: { orderBy: { version: "desc" }, take: 1 },
      linkedBusiness: { select: { id: true, name: true, subscriptionStatus: true, subscriptionPlan: true, createdAt: true } },
    },
  });

  // Sort by latest score desc (score lives in a related table, so sort in application code
  // rather than a raw Prisma orderBy across a one-to-many relation).
  leads.sort((a, b) => (b.scores[0]?.totalScore ?? 0) - (a.scores[0]?.totalScore ?? 0));

  res.json(
    leads.map((lead) => ({
      ...lead,
      latestScore: lead.scores[0]?.totalScore ?? null,
      scores: undefined,
    }))
  );
});

leadFinderRouter.get("/leads/:id", async (req: AuthedRequest, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: {
      scores: { orderBy: { version: "desc" } },
      statusEvents: { orderBy: { createdAt: "desc" } },
      profile: true,
      linkedBusiness: { select: { id: true, name: true, subscriptionStatus: true, subscriptionPlan: true, createdAt: true } },
    },
  });
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  res.json(lead);
});

// Manually link a lead to an existing Business — for the case where the salon signed themselves
// up (rather than the admin creating a trial account for them below), so ROI/conversion tracking
// still connects the two records.
const linkBusinessSchema = z.object({ businessId: z.string().min(1) });
leadFinderRouter.post("/leads/:id/link-business", async (req: AuthedRequest, res) => {
  const parsed = linkBusinessSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [lead, business] = await Promise.all([
    prisma.lead.findUnique({ where: { id: req.params.id } }),
    prisma.business.findUnique({ where: { id: parsed.data.businessId }, select: { id: true } }),
  ]);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (!business) return res.status(404).json({ error: "Business not found" });

  await prisma.$transaction([
    prisma.lead.update({ where: { id: lead.id }, data: { linkedBusinessId: business.id, status: "converted" } }),
    prisma.leadStatusEvent.create({
      data: { leadId: lead.id, fromStatus: lead.status, toStatus: "converted", note: "Linked to existing business" },
    }),
  ]);
  res.json({ ok: true });
});

leadFinderRouter.delete("/leads/:id/link-business", async (req: AuthedRequest, res) => {
  await prisma.lead.update({ where: { id: req.params.id }, data: { linkedBusinessId: null } });
  res.json({ ok: true });
});

// Creates a real trial Business account directly from a lead — for a warm lead who agreed on a
// call, skipping the self-signup step. The salon gets a set-password email (same token flow as
// forgot-password) rather than a password we'd have to relay to them insecurely.
const createAccountSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(), // defaults to the lead's discovered business name
});
leadFinderRouter.post("/leads/:id/create-account", async (req: AuthedRequest, res) => {
  const parsed = createAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (lead.linkedBusinessId) return res.status(409).json({ error: "Lead is already linked to a business" });

  const existing = await prisma.business.findUnique({ where: { email: parsed.data.email } });
  if (existing) return res.status(409).json({ error: "A business with this email already exists — use link-business instead" });

  const businessName = parsed.data.name ?? lead.name;
  // Unguessable placeholder hash — same pattern as Google-signup accounts (lib/authRoutes.ts) —
  // the salon sets their own password via the emailed link below, never receiving this one.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  const business = await prisma.business.create({
    data: { name: businessName, email: parsed.data.email, passwordHash },
  });

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days — longer than the self-serve 30min reset window, since this isn't time-sensitive account recovery
  await prisma.passwordResetToken.create({ data: { businessId: business.id, token, expiresAt } });

  await prisma.$transaction([
    prisma.lead.update({ where: { id: lead.id }, data: { linkedBusinessId: business.id, status: "trial_sent" } }),
    prisma.leadStatusEvent.create({
      data: { leadId: lead.id, fromStatus: lead.status, toStatus: "trial_sent", note: `Trial account created (${parsed.data.email})` },
    }),
  ]);

  sendTrialAccountCreatedEmail(parsed.data.email, businessName, `${APP_URL}/reset-password?token=${token}`).catch((err) =>
    console.error("[leadfinder] Trial account email failed:", err)
  );

  res.status(201).json({ ok: true, businessId: business.id });
});

leadFinderRouter.patch("/leads/:id/status", async (req: AuthedRequest, res) => {
  const parsed = updateStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const { status, note } = parsed.data;
  await prisma.$transaction([
    prisma.lead.update({ where: { id: lead.id }, data: { status } }),
    prisma.leadStatusEvent.create({
      data: { leadId: lead.id, fromStatus: lead.status, toStatus: status, note },
    }),
  ]);

  res.json({ ok: true });
});

// Finds unlinked leads that probably match a business that self-signed-up (rather than being
// created from the lead card) — by name similarity, since Lead has no email and Business doesn't
// collect phone at signup, so name is the only signal in common at this point. Suggestions only;
// linking still goes through POST /leads/:id/link-business so a bad match is never auto-applied.
const MATCH_THRESHOLD = 45;
leadFinderRouter.get("/suggested-matches", async (_req: AuthedRequest, res) => {
  const [leads, businesses] = await Promise.all([
    prisma.lead.findMany({
      where: { linkedBusinessId: null, status: { not: "not_interested" } },
      select: { id: true, name: true, phone: true, campaignId: true },
    }),
    prisma.business.findMany({
      where: { linkedLeads: { none: {} } },
      select: { id: true, name: true, email: true, createdAt: true },
    }),
  ]);

  const suggestions: {
    leadId: string; leadName: string; leadPhone: string | null;
    businessId: string; businessName: string; businessEmail: string; businessCreatedAt: string;
    score: number;
  }[] = [];

  for (const lead of leads) {
    for (const business of businesses) {
      const score = nameSimilarity(lead.name, business.name);
      if (score >= MATCH_THRESHOLD) {
        suggestions.push({
          leadId: lead.id, leadName: lead.name, leadPhone: lead.phone,
          businessId: business.id, businessName: business.name, businessEmail: business.email,
          businessCreatedAt: business.createdAt.toISOString(), score,
        });
      }
    }
  }

  suggestions.sort((a, b) => b.score - a.score);
  res.json(suggestions.slice(0, 50));
});

// --- Outreach ---

leadFinderRouter.get("/leads/:id/outreach", async (req: AuthedRequest, res) => {
  const messages = await prisma.outreachMessage.findMany({
    where: { leadId: req.params.id },
    orderBy: { createdAt: "desc" },
  });
  res.json(messages);
});

// Drafts a personalized outreach message via Claude, from the lead's own enrichment/score data —
// never auto-sent. Always saved with approvalStatus "draft" so the operator reviews/edits before
// anything goes out; see POST /outreach/:id/send below for the only path that actually sends.
const generateOutreachSchema = z.object({
  channel: z.enum(["email", "manual_call"]),
  angle: z.enum(["initial", "follow_up_1"]).default("initial"),
});
leadFinderRouter.post("/leads/:id/outreach/generate", async (req: AuthedRequest, res) => {
  const parsed = generateOutreachSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: { scores: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  try {
    const draft = await generateOutreachDraft(
      {
        name: lead.name,
        category: lead.category,
        address: lead.address,
        rating: lead.rating,
        reviewCount: lead.reviewCount,
        website: lead.website,
        whatsappDetected: lead.whatsappDetected,
        hasOnlineBooking: lead.hasOnlineBooking,
        hasContactForm: lead.hasContactForm,
        websiteStale: lead.websiteStale,
        notes: lead.notes,
      },
      (lead.scores[0]?.breakdown as Record<string, number> | undefined) ?? null,
      parsed.data.channel,
      parsed.data.angle
    );

    const message = await prisma.outreachMessage.create({
      data: {
        leadId: lead.id,
        channel: parsed.data.channel,
        angle: parsed.data.angle,
        subject: draft.subject,
        body: draft.body,
        approvalStatus: "draft",
      },
    });
    res.status(201).json(message);
  } catch (err) {
    console.error("[leadfinder] Outreach generation failed:", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "Draft generation failed" });
  }
});

// Edit a draft before approving it (the model's wording isn't always right — this is meant to be
// touched up by a human, not sent verbatim).
const updateOutreachSchema = z.object({
  subject: z.string().optional(),
  body: z.string().min(1).optional(),
  approvalStatus: z.enum(["draft", "approved", "rejected"]).optional(),
});
leadFinderRouter.patch("/outreach/:id", async (req: AuthedRequest, res) => {
  const parsed = updateOutreachSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const message = await prisma.outreachMessage.update({ where: { id: req.params.id }, data: parsed.data }).catch(() => null);
  if (!message) return res.status(404).json({ error: "Outreach message not found" });
  res.json(message);
});

// Actually sends an approved email draft (real send, via Resend) — or for manual_call, just marks
// it as done since the "send" there is the operator picking up the phone themselves. Requires
// approvalStatus "approved" first, so nothing goes out straight from a fresh, unreviewed draft.
const sendOutreachSchema = z.object({ toEmail: z.string().email().optional() });
leadFinderRouter.post("/outreach/:id/send", async (req: AuthedRequest, res) => {
  const parsed = sendOutreachSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const message = await prisma.outreachMessage.findUnique({ where: { id: req.params.id } });
  if (!message) return res.status(404).json({ error: "Outreach message not found" });
  if (message.approvalStatus !== "approved") return res.status(400).json({ error: "Approve the draft before sending" });
  if (message.sentAt) return res.status(409).json({ error: "Already sent" });

  if (message.channel === "email") {
    if (!parsed.data.toEmail) return res.status(400).json({ error: "toEmail required for email channel" });
    try {
      await sendOutreachEmail(parsed.data.toEmail, message.subject ?? "", message.body);
    } catch (err) {
      return res.status(502).json({ error: err instanceof Error ? err.message : "Send failed" });
    }
  }
  // manual_call: nothing to send programmatically — marking sentAt just records the call happened.

  const updated = await prisma.outreachMessage.update({ where: { id: message.id }, data: { sentAt: new Date() } });
  res.json(updated);
});

// Sends the SAME operator-written message to every eligible lead in the campaign (or a specific
// subset via leadIds) — unlike /leads/:id/outreach/generate+send above, there's no per-lead AI
// draft or approval step here; the operator's own text *is* the approved content. "Eligible"
// means: has a discovered email, hasn't opted out (ConsentLog), and hasn't already received a
// broadcast from a previous call (checked so re-clicking Send after a partial failure doesn't
// re-spam whoever already went out). Paced with a short delay between sends rather than
// Promise.all — this is unsolicited outreach, so hammering Resend/the recipients' mail servers in
// a burst is exactly the pattern that gets a sending domain flagged.
// The WhatsApp channel sends from Tori's OWN outreach WABA (env-configured, not a salon's number)
// and MUST use a pre-approved MARKETING template — Meta blocks free-form business-initiated
// messages to cold numbers (error 131047). The template takes one body variable: the lead's name.
// The template itself must carry an opt-out line to satisfy Meta policy + Israeli spam law, so no
// footer is appended here (unlike email, where the body is arbitrary and we add one).
function toriOutreachConfig() {
  const phoneNumberId = process.env.TORI_OUTREACH_PHONE_NUMBER_ID;
  const accessToken = process.env.TORI_OUTREACH_ACCESS_TOKEN;
  const templateName = process.env.TORI_OUTREACH_TEMPLATE_NAME;
  const languageCode = process.env.TORI_OUTREACH_TEMPLATE_LANG || "he";
  if (!phoneNumberId || !accessToken || !templateName) return null;
  return { phoneNumberId, accessToken, templateName, languageCode };
}

const broadcastSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  leadIds: z.array(z.string()).optional(),
  channel: z.enum(["email", "whatsapp"]).default("email"),
});
leadFinderRouter.post("/campaigns/:id/outreach/broadcast", async (req: AuthedRequest, res) => {
  const parsed = broadcastSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const isWhatsapp = parsed.data.channel === "whatsapp";

  const campaign = await prisma.leadCampaign.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  const waConfig = isWhatsapp ? toriOutreachConfig() : null;
  if (isWhatsapp && !waConfig) {
    return res.status(400).json({
      error:
        "WhatsApp outreach isn't configured. Set TORI_OUTREACH_PHONE_NUMBER_ID, TORI_OUTREACH_ACCESS_TOKEN and TORI_OUTREACH_TEMPLATE_NAME (a Meta-approved MARKETING template with one {{1}} name variable and an opt-out line).",
    });
  }

  // Contact field differs by channel: email needs a discovered email, WhatsApp needs a phone
  // (which Google Places provides for most leads — far higher coverage than email).
  const leads = await prisma.lead.findMany({
    where: {
      campaignId: req.params.id,
      ...(isWhatsapp ? { phone: { not: null } } : { email: { not: null } }),
      ...(parsed.data.leadIds ? { id: { in: parsed.data.leadIds } } : {}),
    },
    select: { id: true, email: true, phone: true, name: true },
  });

  if (leads.length === 0) {
    return res.json({ sent: 0, skippedOptedOut: 0, skippedAlreadySent: 0, failed: 0, failedLeads: [], totalEligible: 0 });
  }

  const leadIds = leads.map((l) => l.id);
  const [optedOutLogs, alreadySentMessages] = await Promise.all([
    prisma.consentLog.findMany({ where: { leadId: { in: leadIds }, event: "opted_out" }, select: { leadId: true } }),
    prisma.outreachMessage.findMany({
      // Scope "already sent" per channel so an email broadcast doesn't block a later WhatsApp one.
      where: { leadId: { in: leadIds }, angle: "broadcast", channel: parsed.data.channel, sentAt: { not: null } },
      select: { leadId: true },
    }),
  ]);
  const optedOutSet = new Set(optedOutLogs.map((l) => l.leadId));
  const alreadySentSet = new Set(alreadySentMessages.map((m) => m.leadId));

  const footer = '\n\n—\nלהסרה מרשימת התפוצה, השיבו למייל זה במילה "הסר".';
  const fullBody = isWhatsapp ? parsed.data.body : `${parsed.data.body}${footer}`;

  let sent = 0;
  let failed = 0;
  const failedLeads: { leadId: string; error: string }[] = [];
  const skippedOptedOut = leads.filter((l) => optedOutSet.has(l.id)).length;
  const skippedAlreadySent = leads.filter((l) => alreadySentSet.has(l.id) && !optedOutSet.has(l.id)).length;

  for (const lead of leads) {
    if (optedOutSet.has(lead.id) || alreadySentSet.has(lead.id)) continue;
    try {
      if (isWhatsapp) {
        await sendWhatsAppTemplate({
          phoneNumberId: waConfig!.phoneNumberId,
          accessToken: waConfig!.accessToken,
          to: lead.phone!,
          templateName: waConfig!.templateName,
          languageCode: waConfig!.languageCode,
          bodyParams: [lead.name ?? "בעל/ת העסק"],
        });
      } else {
        await sendOutreachEmail(lead.email!, parsed.data.subject, fullBody);
      }
      await prisma.outreachMessage.create({
        data: {
          leadId: lead.id,
          channel: parsed.data.channel,
          angle: "broadcast",
          subject: parsed.data.subject,
          body: fullBody,
          approvalStatus: "approved",
          sentAt: new Date(),
        },
      });
      sent += 1;
    } catch (err) {
      failed += 1;
      failedLeads.push({ leadId: lead.id, error: err instanceof Error ? err.message : "Unknown error" });
      console.error(`[leadfinder] Broadcast send failed for lead ${lead.id}:`, err);
    }
    // Pace sends: bursting unsolicited outreach is exactly what flags a sending domain / WABA.
    await new Promise((r) => setTimeout(r, isWhatsapp ? 600 : 350));
  }

  res.json({ sent, skippedOptedOut, skippedAlreadySent, failed, failedLeads, totalEligible: leads.length });
});

// Lightweight business search for the "link to existing business" picker in the lead-linking UI.
leadFinderRouter.get("/businesses-search", async (req: AuthedRequest, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 2) return res.json([]);
  const businesses = await prisma.business.findMany({
    where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] },
    select: { id: true, name: true, email: true, subscriptionStatus: true },
    take: 10,
  });
  res.json(businesses);
});

// --- Scoring config ---

leadFinderRouter.get("/scoring-config", async (_req: AuthedRequest, res) => {
  const weights = await loadScoringWeights();
  res.json({ key: DEFAULT_SCORING_CONFIG_KEY, weights });
});

leadFinderRouter.put("/scoring-config", async (req: AuthedRequest, res) => {
  const parsed = scoringConfigSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const config = await prisma.leadScoringConfig.upsert({
    where: { key: DEFAULT_SCORING_CONFIG_KEY },
    create: { key: DEFAULT_SCORING_CONFIG_KEY, weights: parsed.data.weights },
    update: { weights: parsed.data.weights },
  });
  res.json(config);
});
