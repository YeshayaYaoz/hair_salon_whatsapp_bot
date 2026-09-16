import { prisma } from "./prisma.js";
import { sendAdminAlertEmail } from "./email.js";
import {
  listNumbers,
  getBalance,
  setAutoprolongation,
  prolongNumber,
  ZadarmaNotConfiguredError,
  type ZadarmaNumber,
} from "./zadarmaAdmin.js";
import { mayOrderNumber } from "./numberProvisioning.js";

/**
 * Keeps every paying business's phone number paid for, and stops paying for the rest.
 *
 * A Zadarma number is a monthly rental. With autorenew on, the carrier takes the fee from the
 * account balance on the number's stop date; with it off, or with a balance that cannot cover it,
 * the number lapses and the salon's phone stops ringing. Nothing here used to look: numbers were
 * ordered, wired to Cartesia, and never thought about again. Two ways that goes wrong, in
 * opposite directions —
 *
 *   a paying business loses its line because the one shared balance ran dry, or its number was
 *   ordered with autorenew off; and
 *
 *   a business that cancelled months ago still has a line that Tori pays for every month, because
 *   nothing turned it off.
 *
 * This runs daily. It reads the carrier's view, joins it to the businesses by number, and decides
 * per line: paying → autorenew on; cancelled or blocked → autorenew off (the line lapses at its
 * stop date, so a customer who comes back within the month keeps their number); past_due → left
 * alone, because that is a customer inside the dunning window, not a lost one. It compares the
 * balance to everything due in the next month, since one balance pays for every line at once,
 * and it reports what it could not secure, what it found on the account with no owner, and any
 * business holding a number the carrier no longer lists.
 *
 * The decision is pure (planVoiceNumberRenewal) and the job around it does the I/O, so the rules
 * are tested with lists and a clock rather than a carrier.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Inside this window a paying number that cannot renew is an incident, not a note. */
export const RENEW_AHEAD_DAYS = 7;
/** The balance is judged against everything due within this window. */
export const RUNWAY_DAYS = 30;

const digits = (s: string) => s.replace(/\D/g, "");

export interface NumberBusiness {
  id: string;
  name: string;
  voicePhoneNumber: string | null;
  subscriptionStatus: string;
  blockedAt: Date | null;
}

export type RenewalAction =
  | { kind: "autorenew"; number: string; on: boolean; businessName: string; stopDate: Date | null }
  | { kind: "persist"; businessId: string; stopDate: Date | null; autorenew: boolean };

export interface RenewalReport {
  /** Autorenew switched on for a paying business that had it off. */
  repaired: string[];
  /** Autorenew switched off for a business that stopped paying — the line lapses at its stop date. */
  released: string[];
  /** Prepaid a month because autorenew could not be enabled in time. */
  prolonged: string[];
  /** Paying, expiring soon, and nothing above could secure it. */
  atRisk: string[];
  /** On the carrier account, owned by no business — Tori pays for these. */
  orphans: string[];
  /** A paying business holds a number the carrier no longer lists. */
  dead: string[];
  shortfall: { balance: number; due: number; currency: string; firstExpiry: Date | null } | null;
}

export interface RenewalPlan {
  actions: RenewalAction[];
  report: RenewalReport;
}

const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "no stop date");

/** Whether the business has walked away, as opposed to merely being late. */
function hasLeft(b: NumberBusiness): boolean {
  return b.subscriptionStatus === "canceled" || Boolean(b.blockedAt);
}

export function planVoiceNumberRenewal(
  numbers: ZadarmaNumber[],
  businesses: NumberBusiness[],
  balance: { balance: number; currency: string } | null,
  now: Date
): RenewalPlan {
  const byNumber = new Map<string, NumberBusiness>();
  for (const b of businesses) if (b.voicePhoneNumber) byNumber.set(digits(b.voicePhoneNumber), b);

  const actions: RenewalAction[] = [];
  const report: RenewalReport = { repaired: [], released: [], prolonged: [], atRisk: [], orphans: [], dead: [], shortfall: null };
  const seen = new Set<string>();
  let due = 0;
  let firstExpiry: Date | null = null;

  for (const n of numbers) {
    const key = digits(n.number);
    const biz = byNumber.get(key);
    if (!biz) {
      report.orphans.push(`${n.number} (${n.monthlyFee} ${n.currency}/month, expires ${fmtDate(n.stopDate)})`);
      continue;
    }
    seen.add(key);
    actions.push({ kind: "persist", businessId: biz.id, stopDate: n.stopDate, autorenew: n.autorenew });

    const daysLeft = n.stopDate ? (n.stopDate.getTime() - now.getTime()) / DAY_MS : null;
    const paying = mayOrderNumber(biz);

    if (paying) {
      // Everything a paying business owes the carrier this month counts against the one balance.
      if (daysLeft === null || daysLeft <= RUNWAY_DAYS) {
        due += n.monthlyFee;
        if (n.stopDate && (!firstExpiry || n.stopDate < firstExpiry)) firstExpiry = n.stopDate;
      }
      if (!n.autorenew) {
        actions.push({ kind: "autorenew", number: n.number, on: true, businessName: biz.name, stopDate: n.stopDate });
        report.repaired.push(`${biz.name} ${n.number}`);
      }
      const cannotCover = balance !== null && balance.balance < n.monthlyFee;
      if (daysLeft !== null && daysLeft <= RENEW_AHEAD_DAYS && cannotCover) {
        report.atRisk.push(
          `${biz.name} ${n.number} — expires ${fmtDate(n.stopDate)}, balance ${balance!.balance} ${balance!.currency} cannot cover ${n.monthlyFee} ${n.currency}`
        );
      }
    } else if (hasLeft(biz) && n.autorenew) {
      actions.push({ kind: "autorenew", number: n.number, on: false, businessName: biz.name, stopDate: n.stopDate });
      report.released.push(`${biz.name} ${n.number} — lapses ${fmtDate(n.stopDate)}`);
    }
    // past_due, trial and the like: neither secured nor released. Late is not gone.
  }

  for (const b of businesses) {
    if (!b.voicePhoneNumber || seen.has(digits(b.voicePhoneNumber))) continue;
    if (mayOrderNumber(b)) report.dead.push(`${b.name} ${b.voicePhoneNumber} — not on the carrier account; this line does not ring`);
  }

  if (balance && balance.balance < due) {
    report.shortfall = { balance: balance.balance, due, currency: balance.currency, firstExpiry };
  }

  return { actions, report };
}

function hasSomethingToSay(r: RenewalReport): boolean {
  return Boolean(r.shortfall) || r.atRisk.length > 0 || r.dead.length > 0 || r.orphans.length > 0 || r.released.length > 0 || r.prolonged.length > 0;
}

function renderReport(r: RenewalReport): string {
  const li = (items: string[]) => items.map((i) => `<li><code>${i}</code></li>`).join("");
  const parts: string[] = [];
  if (r.shortfall) {
    parts.push(
      `<h3 style="color:#fff;">Balance cannot cover this month</h3>` +
        `<p style="color:#a1a1aa;">Balance ${r.shortfall.balance} ${r.shortfall.currency}; due within ${RUNWAY_DAYS} days: ${r.shortfall.due}. ` +
        `First expiry ${fmtDate(r.shortfall.firstExpiry)}. Top up, or the lines lapse in order.</p>`
    );
  }
  if (r.atRisk.length) parts.push(`<h3 style="color:#fff;">Paying lines about to lapse</h3><ul style="color:#a1a1aa;">${li(r.atRisk)}</ul>`);
  if (r.dead.length) parts.push(`<h3 style="color:#fff;">Numbers the carrier no longer lists</h3><ul style="color:#a1a1aa;">${li(r.dead)}</ul>`);
  if (r.orphans.length) parts.push(`<h3 style="color:#fff;">Lines on the account with no business — Tori pays for these</h3><ul style="color:#a1a1aa;">${li(r.orphans)}</ul>`);
  if (r.released.length) parts.push(`<h3 style="color:#fff;">Autorenew switched off (business gone)</h3><ul style="color:#a1a1aa;">${li(r.released)}</ul>`);
  if (r.prolonged.length) parts.push(`<h3 style="color:#fff;">Prepaid a month</h3><ul style="color:#a1a1aa;">${li(r.prolonged)}</ul>`);
  if (r.repaired.length) parts.push(`<p style="color:#a1a1aa;">Autorenew switched on for: ${r.repaired.join(", ")}</p>`);
  return parts.join("");
}

export async function runVoiceNumberRenewalJob(): Promise<void> {
  let numbers: ZadarmaNumber[];
  try {
    numbers = await listNumbers();
  } catch (err) {
    if (err instanceof ZadarmaNotConfiguredError) return; // no carrier account on this deployment
    throw err;
  }
  const balance = await getBalance().catch((err) => {
    console.warn("[voiceNumberRenewal] Balance unavailable — renewing on autorenew alone:", err);
    return null;
  });
  const businesses = await prisma.business.findMany({
    where: { voicePhoneNumber: { not: null } },
    select: { id: true, name: true, voicePhoneNumber: true, subscriptionStatus: true, blockedAt: true },
  });

  const { actions, report } = planVoiceNumberRenewal(numbers, businesses, balance, new Date());

  for (const a of actions) {
    if (a.kind === "persist") {
      await prisma.business
        .update({ where: { id: a.businessId }, data: { voiceNumberStopDate: a.stopDate, voiceNumberAutorenew: a.autorenew } })
        .catch((err) => console.error("[voiceNumberRenewal] Could not persist carrier state:", err));
      continue;
    }
    try {
      await setAutoprolongation(a.number, a.on);
      console.log(`[voiceNumberRenewal] autorenew ${a.on ? "on" : "off"} for ${a.number} (${a.businessName})`);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      if (!a.on) {
        report.atRisk.push(`${a.businessName} ${a.number} — could not switch autorenew off (${why}); Tori keeps paying`);
        continue;
      }
      // Could not secure the renewal the normal way. If the line is days from lapsing, prepay a
      // month rather than let it go dark; otherwise report and let tomorrow's run try again.
      const daysLeft = a.stopDate ? (a.stopDate.getTime() - Date.now()) / DAY_MS : null;
      if (daysLeft !== null && daysLeft <= RENEW_AHEAD_DAYS) {
        try {
          const r = await prolongNumber(a.number, 1);
          report.prolonged.push(`${a.businessName} ${a.number} — paid ${r.totalPaid} ${r.currency}, now until ${fmtDate(r.stopDate)}`);
        } catch (err2) {
          const why2 = err2 instanceof Error ? err2.message : String(err2);
          report.atRisk.push(`${a.businessName} ${a.number} — autorenew failed (${why}) and prepay failed (${why2}); expires ${fmtDate(a.stopDate)}`);
        }
      } else {
        report.atRisk.push(`${a.businessName} ${a.number} — could not enable autorenew (${why}); expires ${fmtDate(a.stopDate)}`);
      }
    }
  }

  if (hasSomethingToSay(report)) {
    const n = report.atRisk.length + report.dead.length + (report.shortfall ? 1 : 0);
    await sendAdminAlertEmail(
      n > 0 ? `⚠️ Tori — ${n} voice line problem(s)` : `Tori — voice lines: changes made`,
      renderReport(report)
    ).catch((err) => console.error("[voiceNumberRenewal] Report email failed:", err));
  }
}
