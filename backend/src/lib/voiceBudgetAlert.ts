/**
 * Warns before the Cartesia prepaid balance runs out, because Cartesia will not.
 *
 * The account's prepaid agent dollars hit zero with no notice reaching anyone, and the balance
 * itself is unreadable from here: `/usage/agents` and `/usage/credits` are documented but answer
 * 401 to an API key — like `/api-keys`, they want a logged-in console session. So the warning
 * cannot come from their side, and this builds it from ours instead.
 *
 * That works only because every call is now recorded from Cartesia's own call records with its real
 * duration. The month-to-date sum here is the same arithmetic their invoice does — minutes rounded
 * up per call, at the rate published for every plan — so it is a reading of the balance, not a
 * guess at one. What it cannot see is spend from anything other than agent calls on this agent
 * (voice cloning, TTS outside a call), which is why the threshold leaves room rather than firing at
 * the last dollar.
 */
import { prisma } from "./prisma.js";
import { sendAdminAlertEmail } from "./email.js";

/**
 * Prepaid agent dollars included per month, matching the plan the account is on. Cartesia's tiers
 * (August 2026): Free $1, Pro $5, Startup $49, Scale $299. Set CARTESIA_MONTHLY_PREPAID_USD when
 * the plan changes — nothing here can read the plan, and a stale figure silently moves the alarm.
 */
function monthlyPrepaidUsd(): number {
  const raw = Number(process.env.CARTESIA_MONTHLY_PREPAID_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

/** Cartesia's Line rate, the same on every plan. Mirrors USD_PER_MINUTE in voiceUsage.ts. */
const USD_PER_MINUTE = 0.06;

/**
 * 80 is the heads-up while there is still a working phone line to protect; 100 is its own mail
 * because "getting close" and "already over" call for different reactions — and past 100 the line
 * may simply stop answering, which is the failure nobody was told about last time.
 */
export const ALERT_STEPS = [80, 100] as const;

export interface VoiceBudgetStatus {
  monthStart: Date;
  calls: number;
  billedMinutes: number;
  spentUsd: number;
  budgetUsd: number;
  percent: number;
}

/**
 * Month-to-date agent spend, computed the way it is billed.
 *
 * Per call, rounded up: a provider that bills by the minute bills 70 seconds as two. Summing the
 * seconds first and dividing once would come out under the invoice on every call, and the whole
 * point of this is to fire before the invoice does.
 */
export async function voiceBudgetStatus(now = new Date()): Promise<VoiceBudgetStatus> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rows = await prisma.apiUsageEvent.findMany({
    where: { kind: "voice_call", createdAt: { gte: monthStart } },
    select: { durationSeconds: true },
  });

  const billedMinutes = rows.reduce((sum, r) => sum + Math.ceil((r.durationSeconds ?? 0) / 60), 0);
  const spentUsd = billedMinutes * USD_PER_MINUTE;
  const budgetUsd = monthlyPrepaidUsd();

  return {
    monthStart,
    calls: rows.length,
    billedMinutes,
    spentUsd,
    budgetUsd,
    percent: budgetUsd > 0 ? Math.round((spentUsd / budgetUsd) * 100) : 0,
  };
}

/**
 * The highest step already mailed this calendar month, keyed by month.
 *
 * Keyed by month rather than kept as a rolling flag because the balance itself resets monthly: a
 * new month is a new budget and a new alarm, and a key that names its month needs no reset job and
 * cannot leave last month's state suppressing this month's warning.
 */
function stepKey(monthStart: Date): string {
  return `voice_budget_alert:${monthStart.toISOString().slice(0, 7)}`;
}

export async function runVoiceBudgetAlertJob(): Promise<void> {
  try {
    const status = await voiceBudgetStatus();
    if (status.calls === 0) return;

    const key = stepKey(status.monthStart);
    const stored = await prisma.systemSetting.findUnique({ where: { key } });
    const alreadySent = Number(stored?.value ?? 0);

    // The highest step crossed, so a month that jumps straight past both sends the one mail that
    // describes where things actually stand rather than two in the same minute.
    const crossed = ALERT_STEPS.filter((s) => status.percent >= s);
    const step = crossed.length ? crossed[crossed.length - 1] : 0;
    if (step === 0 || step <= alreadySent) return;

    const remaining = Math.max(0, status.budgetUsd - status.spentUsd);
    await sendAdminAlertEmail(
      step >= 100
        ? `Cartesia: החודש נגמר התקציב הקולי (${status.percent}%)`
        : `Cartesia: ${status.percent}% מהתקציב הקולי נוצל`,
      `<p>מתחילת החודש: <strong>${status.calls}</strong> שיחות, <strong>${status.billedMinutes}</strong> דקות מחויבות.</p>
       <p>הוצאה: <strong>$${status.spentUsd.toFixed(2)}</strong> מתוך $${status.budgetUsd.toFixed(2)} — נשארו $${remaining.toFixed(2)}.</p>
       <p>${
         step >= 100
           ? "מעבר לתקציב המראש, הקו עלול להפסיק לענות. בדוק את החיוב ב-play.cartesia.ai/usage?tab=voice-agents."
           : "עדיין יש קו עובד. אם הקצב נמשך, כדאי להעלות מסלול לפני שהיתרה נגמרת."
       }</p>
       <p style="color:#666;font-size:12px">מחושב מרישומי השיחות של Cartesia עצמה, בדקות מעוגלות כלפי מעלה לכל שיחה — היתרה עצמה אינה קריאה דרך ה-API.</p>`
    );

    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: String(step) },
      update: { value: String(step) },
    });
    console.log(`[voiceBudget] alerted at ${status.percent}% ($${status.spentUsd.toFixed(2)}/$${status.budgetUsd})`);
  } catch (err) {
    console.error("[voiceBudget] alert failed:", err instanceof Error ? err.message : err);
  }
}
