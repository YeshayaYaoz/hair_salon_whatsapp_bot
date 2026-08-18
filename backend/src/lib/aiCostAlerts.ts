import { prisma } from "./prisma.js";
import { sendAdminAlertEmail } from "./email.js";

/**
 * Operator alert for a business whose LLM spend is eating its subscription.
 *
 * In-conversation bot replies are deliberately unmetered — see wallet.ts, blocking a reply
 * mid-booking is worse than absorbing the cost — which means per-business AI spend has no ceiling
 * at all. That is fine at ₪0.37 a conversation and is not fine if one business ever runs hot, and
 * today there is nothing that would tell us until the monthly Anthropic bill arrives.
 *
 * So: no enforcement, just a heads-up to SUPER_ADMIN_EMAIL (us, never the salon) while there is
 * still time to look at what that business is actually doing.
 */

/**
 * Share of a plan's revenue we're willing to spend on inference before it's worth a look.
 *
 * 25% is a threshold, not a target — real usage sits far below it (152 calls cost ₪6.44 against
 * ₪380 of premium revenue, under 2%), so crossing this means something changed, not that the
 * margin is merely thin.
 */
const AI_BUDGET_SHARE_OF_REVENUE = 0.25;

/**
 * Monthly inference budget per plan, in agorot. Trial businesses pay nothing, so there is no
 * revenue to take a share of; their figure is the flat amount worth paying to win a customer.
 */
export const AI_BUDGET_AGOROT_BY_PLAN: Record<string, number> = {
  standard: Math.round(189 * 100 * AI_BUDGET_SHARE_OF_REVENUE), // ₪47.25
  premium: Math.round(380 * 100 * AI_BUDGET_SHARE_OF_REVENUE), // ₪95
};
/** Used for trials and for any plan name not in the table, so a new plan can't silently opt out. */
export const AI_BUDGET_AGOROT_DEFAULT = 2000; // ₪20

export function budgetAgorotFor(plan: string | null): number {
  return AI_BUDGET_AGOROT_BY_PLAN[plan ?? ""] ?? AI_BUDGET_AGOROT_DEFAULT;
}

/**
 * Alert steps, in percent of budget. 70 is the requested heads-up; 100 is worth its own mail
 * because "approaching" and "past" call for different reactions.
 */
export const ALERT_STEPS = [70, 100] as const;

/**
 * Rolling 30 days rather than the billing cycle.
 *
 * The budget is a monthly figure, so a 30-day window measures the right thing, and it needs no new
 * cycle-start column and no coupling to the billing job — which matters because trials are never
 * charged and a failed charge leaves the cycle boundary ambiguous. It also makes the alert state
 * self-healing: as spend ages out of the window the percentage falls back below the step and the
 * business re-arms on its own, with nothing to reset.
 */
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface CostStatus {
  businessId: string;
  name: string;
  plan: string | null;
  spentAgorot: number;
  budgetAgorot: number;
  percent: number;
  calls: number;
  /** Highest step this business has crossed, or 0 if it is under the first one. */
  step: number;
}

/** Spend per business over the window, joined to the plan budget. Read-only. */
export async function collectCostStatuses(now = new Date()): Promise<CostStatus[]> {
  const since = new Date(now.getTime() - WINDOW_MS);

  const [spend, businesses] = await Promise.all([
    prisma.apiUsageEvent.groupBy({
      by: ["businessId"],
      where: { kind: "claude", createdAt: { gte: since } },
      _sum: { costAgorot: true },
      _count: { _all: true },
    }),
    prisma.business.findMany({
      // A blocked business's bot doesn't reply, and a lapsed one isn't producing revenue to
      // measure spend against — neither is an actionable alert.
      where: { blockedAt: null, subscriptionStatus: { in: ["trial", "active"] } },
      select: { id: true, name: true, subscriptionPlan: true },
    }),
  ]);

  const byId = new Map(spend.map((s) => [s.businessId, s]));

  return businesses.map((b) => {
    const row = byId.get(b.id);
    // costAgorot is null for any call on a model with no published rate in usageLedger — those
    // rows are real spend we can't price, so they raise the call count without the shekel figure.
    const spentAgorot = row?._sum.costAgorot ?? 0;
    const budgetAgorot = budgetAgorotFor(b.subscriptionPlan);
    const percent = (spentAgorot / budgetAgorot) * 100;
    const step = [...ALERT_STEPS].reverse().find((s) => percent >= s) ?? 0;
    return {
      businessId: b.id,
      name: b.name,
      plan: b.subscriptionPlan,
      spentAgorot,
      budgetAgorot,
      percent,
      calls: row?._count._all ?? 0,
      step,
    };
  });
}

const ils = (agorot: number) => `₪${(agorot / 100).toFixed(2)}`;

function renderHtml(s: CostStatus): string {
  const past = s.step >= 100;
  return `
    <p style="font-size:15px">
      <strong>${past ? "🔴" : "🟠"} ${s.name}</strong> spent <strong>${ils(s.spentAgorot)}</strong>
      on inference in the last 30 days — ${Math.round(s.percent)}% of the
      ${ils(s.budgetAgorot)} budget for the <code>${s.plan ?? "trial"}</code> plan.
    </p>
    <ul>
      <li>API calls in window: <strong>${s.calls}</strong></li>
      <li>Average per call: <strong>${s.calls > 0 ? (s.spentAgorot / s.calls).toFixed(2) : "—"} אג׳</strong></li>
    </ul>
    <p style="font-size:14px;color:#555">
      Nothing has been limited — in-conversation replies are never blocked. Worth checking the
      business's conversation volume and its cache hit rate in provider stats before doing anything.
    </p>
  `;
}

/**
 * Sends at most one mail per business per step crossed.
 *
 * The sent step is stored so a business sitting at 80% for a fortnight produces one mail rather
 * than one an hour, and is cleared when spend falls back under the step so a genuine second surge
 * still alerts. Storing the step (not a boolean) is what lets 100% arrive after 70% already did.
 */
export async function runAiCostAlertJob(now = new Date()): Promise<void> {
  const statuses = await collectCostStatuses(now);

  for (const s of statuses) {
    const business = await prisma.business.findUnique({
      where: { id: s.businessId },
      select: { aiCostAlertStepSent: true },
    });
    const sent = business?.aiCostAlertStepSent ?? 0;

    if (s.step === sent) continue;

    // Dropped back below a step already alerted on: re-arm quietly, no mail.
    if (s.step < sent) {
      await prisma.business.update({ where: { id: s.businessId }, data: { aiCostAlertStepSent: s.step } });
      continue;
    }

    await sendAdminAlertEmail(
      `Tori — ${s.name} at ${Math.round(s.percent)}% of its AI budget (${ils(s.spentAgorot)})`,
      renderHtml(s)
    ).catch((err) => console.error("[aiCostAlerts] Failed to send alert:", err));

    await prisma.business.update({ where: { id: s.businessId }, data: { aiCostAlertStepSent: s.step } });
    console.log(`[aiCostAlerts] ${s.name} crossed ${s.step}% (${ils(s.spentAgorot)}/${ils(s.budgetAgorot)})`);
  }
}
