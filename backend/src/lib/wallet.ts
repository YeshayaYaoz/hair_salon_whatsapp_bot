import { prisma } from "./prisma.js";

/**
 * Message metering: each plan includes a monthly quota of proactive WhatsApp sends (reminders,
 * review requests, morning digests, ROI reports — NOT in-conversation bot replies, which are
 * unlimited since blocking those would break live bookings). Once a business exceeds its plan's
 * quota for the current billing cycle, further proactive sends draw down the prepaid wallet.
 *
 * Rates/quotas below are placeholders — tune them once real per-message WhatsApp Business API
 * costs and desired margins are decided. Kept in one place so that's a config change, not a
 * code change.
 */
export const MESSAGE_QUOTA_BY_PLAN: Record<string, number> = {
  standard: 300,
  premium: 1000,
  ultra: 3000,
};
const DEFAULT_QUOTA = MESSAGE_QUOTA_BY_PLAN.standard;

/** Cost of one over-quota proactive message, in agorot (1/100 ILS). ₪0.30 placeholder. */
export const COST_PER_MESSAGE_AGOROT = 30;

export interface MeterResult {
  metered: boolean; // true if this send drew from the quota or wallet (i.e. was proactive/counted)
  overQuota: boolean; // true if this specific send was billed against the wallet
  walletBalanceAgorot: number;
  insufficientBalance: boolean; // over quota AND wallet couldn't cover it — send still goes out, just flagged
}

/**
 * Records one proactive WhatsApp send against the business's plan quota, drawing from the wallet
 * once the quota is exceeded. Never blocks the send — a booking reminder failing to go out over a
 * billing technicality is worse than a business owing a small amount, so a low/negative wallet
 * balance is surfaced (to the business and to the super admin) rather than enforced as a hard stop.
 */
export async function meterOutboundMessage(businessId: string): Promise<MeterResult> {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { subscriptionPlan: true, messagesUsedThisCycle: true, walletBalanceAgorot: true },
  });

  const quota = MESSAGE_QUOTA_BY_PLAN[business.subscriptionPlan ?? ""] ?? DEFAULT_QUOTA;
  const overQuota = business.messagesUsedThisCycle >= quota;

  const updated = await prisma.business.update({
    where: { id: businessId },
    data: {
      messagesUsedThisCycle: { increment: 1 },
      ...(overQuota ? { walletBalanceAgorot: { decrement: COST_PER_MESSAGE_AGOROT } } : {}),
    },
    select: { walletBalanceAgorot: true },
  });

  return {
    metered: true,
    overQuota,
    walletBalanceAgorot: updated.walletBalanceAgorot,
    insufficientBalance: overQuota && updated.walletBalanceAgorot < 0,
  };
}
