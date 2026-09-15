import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { captureError } from "../lib/errorMonitoring.js";

/**
 * Durable inbox for inbound WhatsApp messages. See the WhatsAppInbound model for the two failures
 * this exists to close; in short, the webhook used to keep its only state in process memory and
 * acknowledge Meta before doing any work.
 *
 * The contract with the route is strict about order: `recordInbound` runs BEFORE the 200. If the
 * row cannot be written, the route answers 5xx and Meta retries — that is the one situation in
 * which refusing the delivery is the correct move, because it is the only way not to lose it.
 */

export interface InboundIdentity {
  wamid: string;
  phoneNumberId: string;
}

/**
 * Pulls the message id and phone number out of a webhook payload, or null when the delivery is
 * not a user message (delivery statuses, template status updates). Those are not deduplicated
 * here: they carry no wamid of their own, they are idempotent by nature, and losing one costs a
 * ledger entry rather than a customer.
 */
export function inboundIdentity(payload: unknown): InboundIdentity | null {
  const value = (payload as { entry?: Array<{ changes?: Array<{ value?: Record<string, unknown> }> }> })
    ?.entry?.[0]?.changes?.[0]?.value;
  const message = (value?.messages as Array<{ id?: unknown }> | undefined)?.[0];
  const phoneNumberId = (value?.metadata as { phone_number_id?: unknown } | undefined)?.phone_number_id;
  if (typeof message?.id !== "string" || typeof phoneNumberId !== "string") return null;
  return { wamid: message.id, phoneNumberId };
}

export type RecordOutcome = "new" | "duplicate" | "unavailable";

/**
 * Writes the row. "duplicate" means Meta sent this wamid before — the unique index caught it, and
 * the caller should acknowledge and do nothing. "unavailable" means the database refused for any
 * other reason, and the caller should NOT acknowledge, so Meta redelivers once it recovers.
 */
export async function recordInbound(identity: InboundIdentity, payload: unknown): Promise<RecordOutcome> {
  try {
    await prisma.whatsAppInbound.create({
      data: {
        wamid: identity.wamid,
        phoneNumberId: identity.phoneNumberId,
        payload: payload as Prisma.InputJsonValue,
        startedAt: new Date(),
        attempts: 1,
      },
    });
    return "new";
  } catch (err) {
    // The code alone, not instanceof: only Prisma raises P2002, and the class check adds nothing
    // except brittleness across client versions and test doubles.
    if ((err as { code?: unknown })?.code === "P2002") return "duplicate";
    console.error("[whatsapp inbox] Could not record inbound message — refusing the delivery so Meta retries:", err);
    captureError(err, { kind: "inboundRecord", wamid: identity.wamid });
    return "unavailable";
  }
}

/** Best effort: a failure here leaves the row for the sweep to find, which reprocesses it once. */
export async function markProcessed(wamid: string): Promise<void> {
  await prisma.whatsAppInbound
    .update({ where: { wamid }, data: { processedAt: new Date(), lastError: null } })
    .catch((err) => console.error(`[whatsapp inbox] Could not mark ${wamid} processed:`, err));
}

/**
 * How long a row may sit with startedAt set and processedAt unset before the sweep assumes the
 * worker died. A reply that involves transcription and a model call can legitimately take a
 * minute; three is a crash for practical purposes.
 */
const STALE_AFTER_MS = 3 * 60 * 1000;
/** Two goes in total: the original handler, then one retry. A message that fails twice on its own
 * merits is not going to succeed a third time, and each retry risks a second reply. */
const MAX_ATTEMPTS = 2;

/**
 * Reprocesses messages whose handler never finished. Runs at startup — which is exactly when the
 * rows it is looking for were created, by the process that was just replaced — and then on a
 * short interval.
 *
 * Claims each row with a conditional update before touching it, the same pattern the billing job
 * uses (claimForCharging): two instances running this sweep cannot both pick up one message.
 */
export async function runInboundRecoveryJob(
  process: (payload: unknown) => Promise<void>
): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await prisma.whatsAppInbound.findMany({
    where: {
      processedAt: null,
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ startedAt: null }, { startedAt: { lt: cutoff } }],
    },
    orderBy: { receivedAt: "asc" },
    take: 50,
    select: { id: true, wamid: true, payload: true, attempts: true },
  });

  for (const row of stale) {
    const { count } = await prisma.whatsAppInbound.updateMany({
      where: { id: row.id, attempts: row.attempts, processedAt: null },
      data: { startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (count !== 1) continue; // someone else got it first

    console.warn(`[whatsapp inbox] Recovering ${row.wamid} (attempt ${row.attempts + 1}) — its handler never finished`);
    try {
      await process(row.payload);
      await markProcessed(row.wamid);
    } catch (err) {
      // process() swallows its own errors and replies to the customer; reaching here means
      // something outside that path threw. Record it and let the attempt count decide.
      const message = err instanceof Error ? err.message : String(err);
      await prisma.whatsAppInbound
        .update({ where: { id: row.id }, data: { lastError: message.slice(0, 500) } })
        .catch(() => {});
      captureError(err, { kind: "inboundRecovery", wamid: row.wamid });
    }
  }
}

/**
 * Rows whose handler gave up — the number the health card shows. Anything here is a customer who
 * wrote and, as far as this system can tell, never got an answer.
 */
export async function countAbandonedInbound(): Promise<number> {
  return prisma.whatsAppInbound.count({
    where: { processedAt: null, attempts: { gte: MAX_ATTEMPTS } },
  });
}
