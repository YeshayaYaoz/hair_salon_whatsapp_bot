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
