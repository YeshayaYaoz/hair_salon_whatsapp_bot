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
import { listAgentCalls, CartesiaNotConfiguredError, type CartesiaCall } from "./cartesiaAdmin.js";
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
  const businesses = await prisma.business.findMany({
    where: { voicePhoneNumber: { not: null } },
    select: { id: true, voicePhoneNumber: true },
  });
  const byNumber = new Map(businesses.map((b) => [normalizePhone(b.voicePhoneNumber!), b.id]));

  let recorded = 0;
  let unattributed = 0;
  let skipped = 0;

  for (const c of calls) {
    const seconds = callDurationSeconds(c);
    // Still ringing or still talking. Not an error and not a skip worth reporting — it will have
    // an end time by the next tick, which is why the window is re-read rather than advanced past.
    if (seconds === null) continue;

    const dialled = c.telephony_params?.to;
    const businessId = dialled ? byNumber.get(normalizePhone(dialled)) : undefined;
    if (!businessId) {
      // A call to a number no salon claims — a test call to an unassigned number, or a salon whose
      // number was changed since. It still cost money, so it is counted in the total the operator
      // sees; it just cannot be billed to anyone.
      unattributed++;
      continue;
    }

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
        },
      });
      recorded++;
    } catch (err) {
      // The unique index doing its job: this call was recorded on an earlier tick.
      if (isUniqueViolation(err)) skipped++;
      else throw err;
    }
  }

  return { fetched: calls.length, recorded, unattributed, skipped };
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
