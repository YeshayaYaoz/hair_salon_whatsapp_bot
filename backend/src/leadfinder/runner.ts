/**
 * Orchestrates a single LeadFinderRun end-to-end: discover businesses via Google Places,
 * upsert them as Leads (deduped by placeId within the campaign), enrich each lead's website,
 * score each lead, and update the run's progress/status as it goes so the admin UI can poll it.
 *
 * Triggered per-campaign-run from routes.ts (fire-and-forget — the HTTP handler does not await
 * this), not on a schedule, so it does not use runTrackedJob/setInterval like the global
 * booking-reminder jobs do.
 */
import { prisma } from "../lib/prisma.js";
import { captureError } from "../lib/errorMonitoring.js";
import { discoverBusinesses } from "./placesClient.js";
import { enrichWebsite } from "./enrichment.js";
import { loadScoringWeights, scoreLead } from "./scoring.js";

export async function executeLeadFinderRun(runId: string): Promise<void> {
  const run = await prisma.leadFinderRun.findUnique({ where: { id: runId }, include: { campaign: true } });
  if (!run) {
    console.error(`[leadfinder] Run ${runId} not found`);
    return;
  }

  try {
    await prisma.leadFinderRun.update({
      where: { id: runId },
      data: { status: "discovering", startedAt: new Date() },
    });

    const discovered = await discoverBusinesses(run.campaign.category, run.campaign.locationQuery);

    await prisma.leadFinderRun.update({ where: { id: runId }, data: { totalFound: discovered.length } });

    // Dedupe by placeId within the campaign: upsert since placeId is globally unique in the
    // table (a business could theoretically be pulled into two campaigns; upsert-by-placeId
    // keeps the row attached to whichever campaign first discovered it rather than erroring).
    const leadIds: string[] = [];
    for (const biz of discovered) {
      const lead = await prisma.lead.upsert({
        where: { placeId: biz.placeId },
        create: {
          campaignId: run.campaignId,
          placeId: biz.placeId,
          name: biz.name,
          address: biz.address,
          phone: biz.phone,
          website: biz.website,
          rating: biz.rating,
          reviewCount: biz.reviewCount,
          businessHours: biz.businessHours ?? undefined,
          socialLinks: biz.socialLinks ?? undefined,
          category: run.campaign.category,
        },
        update: {
          name: biz.name,
          address: biz.address,
          phone: biz.phone,
          website: biz.website,
          rating: biz.rating,
          reviewCount: biz.reviewCount,
          businessHours: biz.businessHours ?? undefined,
        },
      });
      leadIds.push(lead.id);
    }

    await prisma.leadFinderRun.update({ where: { id: runId }, data: { status: "enriching" } });

    let enrichedCount = 0;
    for (const leadId of leadIds) {
      const lead = await prisma.lead.findUnique({ where: { id: leadId } });
      if (!lead) continue;
      try {
        const enrichment = await enrichWebsite(lead.website);
        await prisma.lead.update({
          where: { id: leadId },
          data: {
            hasOnlineBooking: enrichment.hasOnlineBooking,
            hasContactForm: enrichment.hasContactForm,
            whatsappDetected: enrichment.whatsappDetected,
            websiteStale: enrichment.websiteStale,
          },
        });
      } catch (err) {
        // A single lead's enrichment failing must never abort the whole run.
        console.warn(`[leadfinder] Enrichment failed for lead ${leadId}:`, err);
      }
      enrichedCount += 1;
      await prisma.leadFinderRun.update({ where: { id: runId }, data: { totalEnriched: enrichedCount } });
    }

    await prisma.leadFinderRun.update({ where: { id: runId }, data: { status: "scoring" } });

    const weights = await loadScoringWeights();
    let scoredCount = 0;
    for (const leadId of leadIds) {
      const lead = await prisma.lead.findUnique({ where: { id: leadId } });
      if (!lead) continue;
      const { totalScore, breakdown } = scoreLead(
        {
          website: lead.website,
          hasOnlineBooking: lead.hasOnlineBooking,
          hasContactForm: lead.hasContactForm,
          whatsappDetected: lead.whatsappDetected,
          websiteStale: lead.websiteStale,
          reviewCount: lead.reviewCount,
        },
        weights
      );
      const previousVersions = await prisma.leadScore.count({ where: { leadId } });
      await prisma.leadScore.create({
        data: { leadId, version: previousVersions + 1, totalScore, breakdown },
      });
      scoredCount += 1;
      await prisma.leadFinderRun.update({ where: { id: runId }, data: { totalScored: scoredCount } });
    }

    await prisma.leadFinderRun.update({
      where: { id: runId },
      data: { status: "completed", completedAt: new Date() },
    });
  } catch (err) {
    console.error(`[leadfinder] Run ${runId} failed:`, err);
    captureError(err, { leadFinderRunId: runId });
    const message = err instanceof Error ? err.message : String(err);
    await prisma.leadFinderRun
      .update({ where: { id: runId }, data: { status: "failed", errorMessage: message, completedAt: new Date() } })
      .catch((dbErr) => console.error(`[leadfinder] Failed to record run failure for ${runId}:`, dbErr));
  }
}
