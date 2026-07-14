import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { requireSuperAdmin } from "../api/businessRoutes.js";
import { executeLeadFinderRun } from "./runner.js";
import { loadScoringWeights, DEFAULT_SCORING_CONFIG_KEY } from "./scoring.js";

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
    include: { scores: { orderBy: { version: "desc" }, take: 1 } },
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
    },
  });
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  res.json(lead);
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
