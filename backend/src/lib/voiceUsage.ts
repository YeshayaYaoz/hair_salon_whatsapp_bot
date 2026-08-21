/**
 * Voice call minutes, reconciled from Cartesia's own call records.
 *
 * The account's prepaid agent balance ran out with no warning reaching us, and the reason was a
 * gap in what this product measured: `/api/voice/usage` recorded the LLM tokens a call spent — a
 * fraction of an agora each — while the minute those tokens were spoken in, at $0.06, was recorded
 * nowhere. The cheap half was metered per business and the expensive half was invisible.
 *
 * The numbers here are not ours. We could time a call from the ring (when the agent fetches
 * /context) to the last thing the model said, and that estimate would run short by however long
 * the caller kept talking afterwards, and would miss entirely a call that hung up before the agent
 * got a context — which still costs money. Cartesia's record has the real start and end, so that is
 * what gets read.
 */
import { prisma } from "./prisma.js";
import { toHebrewSummary } from "./hebrewSummary.js";
import { listAgentCalls, CartesiaNotConfiguredError, type CartesiaCall, type CartesiaTurn } from "./cartesiaAdmin.js";
import { normalizePhone } from "./phone.js";

/**
 * Cartesia's published Line rate, identical on every plan (checked August 2026) — the tier changes
 * how many dollars are prepaid and how many calls may run at once, never the price of a minute.
 *
 * Telephony is deliberately not added: their $0.014/min applies only to numbers Cartesia itself
 * provisioned, and every salon's number comes from our own SIP trunk instead.
 */
const USD_PER_MINUTE = 0.06;

/** Same rate the token ledger converts with — see usageLedger.ts. */
const USD_TO_ILS = 3.7;

/** Rounded up, because a provider billing by the minute bills a partial minute as a whole one. */
export function callCostAgorot(durationSeconds: number): number {
  return Math.round(Math.ceil(durationSeconds / 60) * USD_PER_MINUTE * USD_TO_ILS * 100);
}

/**
 * Writes one ApiUsageEvent per finished call, attributed to the salon whose number was dialled.
 *
 * Re-reading a window rather than tracking a cursor: a call that was still open on the last tick
 * has no end time yet, and its duration only becomes knowable afterwards. The unique externalId is
 * what makes re-reading safe — a call already recorded is skipped, so the same call cannot be
 * counted twice however often this runs.
 *
 * Returns what it did, so the operator-facing sync can say "nothing to record" and mean it.
 */
export async function syncVoiceCallUsage(days = 3): Promise<{
  fetched: number;
  recorded: number;
  unattributed: number;
  skipped: number;
}> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const calls = await listAgentCalls(since);

  // Every voice-enabled salon, matched on digits: a number is stored as the owner typed it and
  // arrives from Cartesia in E.164, and the two disagree about the leading "+" and about spaces.
  const byNumber = await voiceNumberIndex();

  let recorded = 0;
  let unattributed = 0;
  let skipped = 0;

  for (const c of calls) {
    const outcome = await recordCall(c, byNumber);
    if (outcome === "recorded") recorded++;
    else if (outcome === "unattributed") unattributed++;
    else if (outcome === "duplicate") skipped++;
  }

  return { fetched: calls.length, recorded, unattributed, skipped };
}

/** Which salon owns each voice number, keyed on digits. Shared by the sync and the webhook. */
export async function voiceNumberIndex(): Promise<Map<string, string>> {
  const businesses = await prisma.business.findMany({
    where: { voicePhoneNumber: { not: null } },
    select: { id: true, voicePhoneNumber: true },
  });
  return new Map(businesses.map((b) => [normalizePhone(b.voicePhoneNumber!), b.id]));
}

export type RecordOutcome = "recorded" | "duplicate" | "unattributed" | "open";

/**
 * Writes one call to the ledger. The only place a voice_call row is created — the hourly sync and
 * the webhook both come through here, so a call recorded by whichever arrives first is identical to
 * the one the other would have written, and the second is a no-op.
 */
export async function recordCall(c: CartesiaCall, byNumber: Map<string, string>): Promise<RecordOutcome> {
  const seconds = callDurationSeconds(c);
  // Still ringing or still talking. Not an error and not a skip worth reporting — it will have an
  // end time by the next tick, which is why the window is re-read rather than advanced past.
  if (seconds === null) return "open";

  const dialled = c.telephony_params?.to;
  const businessId = dialled ? byNumber.get(normalizePhone(dialled)) : undefined;
  if (!businessId) {
    // A call to a number no salon claims — a test call to an unassigned number, or a salon whose
    // number was changed since. It still cost money, so it is counted in the total the operator
    // sees; it just cannot be billed to anyone.
    return "unattributed";
  }

  const metrics = transcriptMetrics(c.transcript);
  // Translated once, up front, so the create and the duplicate-update below can never disagree
  // about which language got stored. Cartesia writes its post-call summaries in English; the
  // owner reading them is on a Hebrew dashboard. Fail-open — see hebrewSummary.ts.
  const summary = await toHebrewSummary(c.summary);

  try {
    await prisma.apiUsageEvent.create({
      data: {
        businessId,
        customerPhone: c.telephony_params?.from || "unknown",
        kind: "voice_call",
        provider: "cartesia",
        externalId: c.id,
        durationSeconds: seconds,
        costAgorot: callCostAgorot(seconds),
        summary,
        ...metrics,
      },
    });
    return "recorded";
  } catch (err) {
    // The unique index doing its job: this call was recorded already. The webhook carries a
    // transcript the list endpoint does not, so a duplicate is still worth writing through for the
    // fields the first write could not have had — never for the billing figures, which are settled.
    if (!isUniqueViolation(err)) throw err;
    if (metrics.ttfbMsMedian !== null || summary) {
      await prisma.apiUsageEvent.updateMany({
        where: { externalId: c.id },
        data: {
          ...(summary ? { summary } : {}),
          ...(metrics.ttfbMsMedian !== null ? metrics : {}),
        },
      });
    }
    return "duplicate";
  }
}

/**
 * The two readings worth keeping from a call's transcript.
 *
 * Median rather than mean for the latency: one turn that waited on a slow tool call should not
 * decide what the call felt like, and with a handful of turns the median is the turn a caller
 * would describe. Null when no turn reported a timing, which is every call fetched from the list
 * endpoint — it carries no transcript.
 */
export function transcriptMetrics(turns?: CartesiaTurn[] | null): { ttfbMsMedian: number | null; interruptions: number | null } {
  if (!turns || turns.length === 0) return { ttfbMsMedian: null, interruptions: null };

  const agentTurns = turns.filter((t) => t.role === "assistant");
  const ttfbs = agentTurns
    .map((t) => t.tts_ttfb)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);

  const median = ttfbs.length === 0 ? null : Math.round(ttfbs[Math.floor(ttfbs.length / 2)] * 1000);
  return {
    ttfbMsMedian: median,
    interruptions: agentTurns.filter((t) => t.was_interrupted === true).length,
  };
}

/** Null while a call is still open — Cartesia has no end time for it yet. */
export function callDurationSeconds(c: CartesiaCall): number | null {
  if (!c.end_time) return null;
  const ms = new Date(c.end_time).getTime() - new Date(c.start_time).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 1000);
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/**
 * The scheduled wrapper. Hourly is frequent enough that the admin panel is never more than an hour
 * stale, and the three-day window means an outage of that length repairs itself on the next tick
 * with no backfill to run by hand.
 */
export async function runVoiceUsageSyncJob(): Promise<void> {
  try {
    const result = await syncVoiceCallUsage();
    if (result.recorded > 0 || result.unattributed > 0) {
      console.log(
        `[voiceUsage] ${result.recorded} call(s) recorded, ${result.unattributed} unattributed, ` +
          `${result.skipped} already known, of ${result.fetched} fetched`
      );
    }
  } catch (err) {
    // An account without voice configured is the normal state of a fresh deployment, not a fault
    // worth a stack trace every hour.
    if (err instanceof CartesiaNotConfiguredError) return;
    console.error("[voiceUsage] sync failed:", err instanceof Error ? err.message : err);
  }
}
