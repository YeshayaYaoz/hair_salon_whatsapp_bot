import { prisma } from "../lib/prisma.js";

/**
 * Idempotency for subscription charges, one row per business per billing period. See the
 * SubscriptionCharge model for the crash this closes: money taken, process dies, due date never
 * advanced, next day's run charges the same period again.
 *
 * The shape of the answer matters more than the mechanism. There are four things a run can learn
 * about a period, and only one of them is "go ahead and charge":
 *
 *   new        — nothing on record; a pending row is now written and the caller should charge.
 *   charged    — PayPlus already took this period's money. Advance the date, do not charge.
 *   in-flight  — another run wrote the pending row moments ago and is presumably mid-charge.
 *                Do nothing; it will settle.
 *   unknown    — a pending row has sat for longer than any charge takes. The run that wrote it
 *                died and nobody knows whether PayPlus moved the money. Do NOT charge; a person
 *                has to look at the transaction. Reported once, then parked as "unknown" so the
 *                hourly runs stop asking.
 */
export type ChargeClaim =
  | { kind: "new" }
  | { kind: "charged"; transactionId: string | null }
  | { kind: "in-flight" }
  | { kind: "unknown" };

/** A token charge round-trips in seconds. A pending row older than this belongs to a dead run. */
const IN_FLIGHT_GRACE_MS = 10 * 60 * 1000;

/**
 * The due date, as a day. It is a key, not a display, so UTC is the right calendar: it never
 * shifts across a DST change and two runs on either side of midnight anywhere agree on it.
 */
export function periodKeyFor(dueDate: Date | null | undefined, now: Date): string {
  return (dueDate ?? now).toISOString().slice(0, 10);
}

export async function claimChargeForPeriod(businessId: string, periodKey: string, amountIls: number): Promise<ChargeClaim> {
  try {
    await prisma.subscriptionCharge.create({ data: { businessId, periodKey, amountIls, status: "pending" } });
    return { kind: "new" };
  } catch (err) {
    if ((err as { code?: unknown })?.code !== "P2002") throw err;
  }

  const existing = await prisma.subscriptionCharge.findUniqueOrThrow({
    where: { businessId_periodKey: { businessId, periodKey } },
  });

  switch (existing.status) {
    case "charged":
      return { kind: "charged", transactionId: existing.transactionId };
    case "failed":
      // A real decline took no money, so a fresh attempt at the same period is fine — this is a
      // business coming back from past_due after fixing its card.
      await prisma.subscriptionCharge.update({ where: { id: existing.id }, data: { status: "pending", error: null } });
      return { kind: "new" };
    case "unknown":
      return { kind: "in-flight" }; // already reported; parked until a person resolves the row
    default: {
      const age = Date.now() - existing.updatedAt.getTime();
      if (age < IN_FLIGHT_GRACE_MS) return { kind: "in-flight" };
      await prisma.subscriptionCharge.update({ where: { id: existing.id }, data: { status: "unknown" } });
      return { kind: "unknown" };
    }
  }
}

/** Settles the pending row the claim wrote. Best effort — a failure here leaves "pending", which
 * the next run reports as unknown rather than charging again, i.e. it fails safe. */
export async function recordChargeOutcome(
  businessId: string,
  periodKey: string,
  result: { success: boolean; transactionId?: string; error?: string }
): Promise<void> {
  await prisma.subscriptionCharge
    .update({
      where: { businessId_periodKey: { businessId, periodKey } },
      data: result.success
        ? { status: "charged", transactionId: result.transactionId ?? null, error: null }
        : { status: "failed", error: (result.error ?? "unknown").slice(0, 500) },
    })
    .catch((err) => console.error(`[chargeLedger] Could not settle ${businessId}/${periodKey}:`, err));
}
