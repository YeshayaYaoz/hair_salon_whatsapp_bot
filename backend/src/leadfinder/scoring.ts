/**
 * Configurable lead scoring. Weights live in the DB (LeadScoringConfig, key "default") rather
 * than being hardcoded, so a super admin can tune them without a deploy. The scoring function
 * itself is pure — (lead data, weights) -> {totalScore, breakdown} — so it's easy to unit test
 * without touching Prisma.
 */
import { prisma } from "../lib/prisma.js";

export const DEFAULT_SCORING_CONFIG_KEY = "default";

export interface ScoringWeights {
  noOnlineBooking: number; // no booking system at all — high opportunity for Tori
  whatsappNoAutomation: number; // has WhatsApp presence but clearly not using it as a bot
  highReviewCount: number; // established business, likely to have budget
  highReviewCountThreshold: number;
  oldWebsite: number; // stale website — needs attention, receptive to upgrading
  noWebsite: number; // no website at all — biggest opportunity, but harder to reach/verify
  hasContactFormNoBooking: number; // takes inbound contact seriously but manually
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  noOnlineBooking: 30,
  whatsappNoAutomation: 25,
  highReviewCount: 20,
  highReviewCountThreshold: 50,
  oldWebsite: 15,
  noWebsite: 20,
  hasContactFormNoBooking: 10,
};

export interface ScorableLead {
  website: string | null;
  hasOnlineBooking: boolean | null;
  hasContactForm: boolean | null;
  whatsappDetected: boolean;
  websiteStale: boolean | null;
  reviewCount: number | null;
}

export interface ScoreResult {
  totalScore: number;
  breakdown: Record<string, number>;
}

/** Loads the "default" scoring config, seeding sensible defaults if it doesn't exist yet. */
export async function loadScoringWeights(): Promise<ScoringWeights> {
  const config = await prisma.leadScoringConfig.upsert({
    where: { key: DEFAULT_SCORING_CONFIG_KEY },
    create: { key: DEFAULT_SCORING_CONFIG_KEY, weights: DEFAULT_SCORING_WEIGHTS as unknown as object },
    update: {},
  });
  return { ...DEFAULT_SCORING_WEIGHTS, ...(config.weights as Partial<ScoringWeights>) };
}

/**
 * Pure scoring function per the spec's rules:
 * - no booking system at all -> high score (biggest automation opportunity)
 * - has WhatsApp but no automation -> high score (Tori's exact wedge)
 * - high review count -> high score (established business, has budget)
 * - old/stale website -> medium-high score (receptive to a refresh + new booking flow)
 */
export function scoreLead(lead: ScorableLead, weights: ScoringWeights): ScoreResult {
  const breakdown: Record<string, number> = {};

  if (!lead.website) {
    breakdown.noWebsite = weights.noWebsite;
  } else if (lead.hasOnlineBooking === false) {
    breakdown.noOnlineBooking = weights.noOnlineBooking;
  }

  if (lead.whatsappDetected && lead.hasOnlineBooking !== true) {
    breakdown.whatsappNoAutomation = weights.whatsappNoAutomation;
  }

  if ((lead.reviewCount ?? 0) >= weights.highReviewCountThreshold) {
    breakdown.highReviewCount = weights.highReviewCount;
  }

  if (lead.websiteStale === true) {
    breakdown.oldWebsite = weights.oldWebsite;
  }

  if (lead.hasContactForm === true && lead.hasOnlineBooking === false) {
    breakdown.hasContactFormNoBooking = weights.hasContactFormNoBooking;
  }

  const totalScore = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { totalScore, breakdown };
}
