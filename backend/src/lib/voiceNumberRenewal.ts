import { prisma } from "./prisma.js";
import { sendAdminAlertEmail } from "./email.js";
import { notifyOwner } from "./ownerNotify.js";
import {
  listNumbers,
  getBalance,
  setAutoprolongation,
  prolongNumber,
  ZadarmaNotConfiguredError,
  type ZadarmaNumber,
} from "./zadarmaAdmin.js";
import { mayOrderNumber } from "./numberProvisioning.js";
import { NUMBER_GRACE_DAYS, numberHeldUntil } from "./numberGrace.js";

/**
 * Keeps every paying business's phone number paid for, holds a lapsed one for a month, and stops
 * paying for the rest.
 *
 * A Zadarma number is a monthly rental. With autorenew on, the carrier takes the fee from the
 * account balance on the number's stop date; with it off, or with a balance that cannot cover it,
 * the number goes to "parking" for seven days and is then gone for good. Nothing here used to
 * look: numbers were ordered, wired to Cartesia, and never thought about again. Two ways that goes
 * wrong, in opposite directions —
 *
 *   a paying business loses its line because the one shared balance ran dry, or its number was
 *   ordered with autorenew off; and
 *
 *   a business that cancelled months ago still has a line that Tori pays for every month, because
 *   nothing turned it off.
 *
 * And a third, which is the reason for the month in the middle: a salon whose card failed loses
 * its number the week it is sorting the card out, and comes back to a re-onboarding — new number
 * to print, new WhatsApp to verify. The number IS the business's line, so it is held.
 *
 * This runs daily. It reads the carrier's view, joins it to the businesses by number, and decides
 * per line:
 *
 *   paying              → autorenew on; a line the carrier has parked is bought back.
 *   stopped paying,     → held: autorenew stays on, Tori pays, the owner was told the date.
 *     under a month
 *   stopped paying,     → released: autorenew off, the line lapses at its stop date. Once the
 *     over a month         carrier no longer lists it, the number is taken off the business so a
 *                          return orders a fresh one instead of pointing at a dead line.
 *   trial               → left alone; a trial with a number is the operator's decision.
 *
 * "Stopped paying" is past_due, canceled or blocked, dated by subscriptionLapsedAt (or blockedAt).
 * A lapsed business with no date gets one stamped today, so the month always starts somewhere.
 * It compares the balance to everything due in the next month, since one balance pays for every
 * line at once, and it reports what it could not secure, what it found on the account with no
 * owner, and any paying business holding a number the carrier no longer lists.
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
  /** Set when Tori bought the number; null means the owner brought their own line. */
  voiceNumberOrderedAt: Date | null;
  subscriptionStatus: string;
  subscriptionLapsedAt: Date | null;
  blockedAt: Date | null;
}

export type RenewalAction =
  | { kind: "autorenew"; number: string; on: boolean; businessName: string; stopDate: Date | null }
  /** Autorenew switched off and the owner told: the hold is over. Emitted once, on the flip. */
  | { kind: "release-notice"; businessId: string; number: string; stopDate: Date | null }
  /** A paying business's line sits in the carrier's parking; prepay a month to bring it back. */
  | { kind: "restore"; number: string; businessId: string; businessName: string }
  /** The carrier no longer lists a released number; take it off the business. */
  | { kind: "detach"; businessId: string; businessName: string; number: string }
  /** A lapsed business with no lapse date: start the clock today. */
  | { kind: "stamp"; businessId: string; lapsedAt: Date }
  | { kind: "persist"; businessId: string; stopDate: Date | null; autorenew: boolean };

export interface RenewalReport {
  /** Autorenew switched on for a paying business that had it off. */
  repaired: string[];
  /** Stopped paying less than a month ago — Tori keeps the line, and pays for it. */
  held: string[];
  /** Autorenew switched off for a business whose month is up — the line lapses at its stop date. */
  released: string[];
  /** A parked line bought back for a business that is paying again. */
  restored: string[];
  /** Released numbers the carrier has now dropped, taken off their businesses. */
  detached: string[];
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

/** Whether the business has stopped paying, as opposed to never having started (trial). */
function hasLapsed(b: NumberBusiness): boolean {
  return b.subscriptionStatus === "canceled" || b.subscriptionStatus === "past_due" || Boolean(b.blockedAt);
}

/** When the business stopped paying — the earlier of the lapse and a block, if both. */
function lapsedAt(b: NumberBusiness): Date | null {
  const dates = [b.subscriptionLapsedAt, b.blockedAt].filter((d): d is Date => d instanceof Date);
  return dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
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
  const report: RenewalReport = {
    repaired: [], held: [], released: [], restored: [], detached: [], prolonged: [], atRisk: [], orphans: [], dead: [], shortfall: null,
  };
  const seen = new Set<string>();
  let due = 0;
  let firstExpiry: Date | null = null;

  /** A line Tori intends to keep paying for: counts against the balance and must have autorenew on. */
  const secure = (n: ZadarmaNumber, biz: NumberBusiness, daysLeft: number | null) => {
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
  };

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

    if (mayOrderNumber(biz)) {
      // Paying. A line the carrier parked — it lapsed while the business was away and they came
      // back inside the carrier's seven days — is bought back before anything else.
      if (n.status === "parking") {
        actions.push({ kind: "restore", number: n.number, businessId: biz.id, businessName: biz.name });
        report.restored.push(`${biz.name} ${n.number}`);
      }
      secure(n, biz, daysLeft);
      continue;
    }

    if (!hasLapsed(biz)) continue; // trial and the like: neither secured nor released

    let since = lapsedAt(biz);
    if (!since) {
      since = now;
      actions.push({ kind: "stamp", businessId: biz.id, lapsedAt: now });
    }
    const heldUntil = numberHeldUntil(since);
    if (now < heldUntil) {
      // Inside the month: the line is kept exactly as a paying one would be, so a renewal tomorrow
      // finds everything where it was.
      secure(n, biz, daysLeft);
      report.held.push(`${biz.name} ${n.number} — held until ${fmtDate(heldUntil)}`);
      continue;
    }
    if (n.autorenew) {
      actions.push({ kind: "autorenew", number: n.number, on: false, businessName: biz.name, stopDate: n.stopDate });
      actions.push({ kind: "release-notice", businessId: biz.id, number: n.number, stopDate: n.stopDate });
      report.released.push(`${biz.name} ${n.number} — stopped paying ${fmtDate(since)}, lapses ${fmtDate(n.stopDate)}`);
    }
  }

  for (const b of businesses) {
    if (!b.voicePhoneNumber || seen.has(digits(b.voicePhoneNumber))) continue;
    if (mayOrderNumber(b)) {
      report.dead.push(`${b.name} ${b.voicePhoneNumber} — not on the carrier account; this line does not ring`);
    } else if (hasLapsed(b) && b.voiceNumberOrderedAt) {
      // Released, and now gone from the carrier. Only a number Tori bought is taken off the
      // business: a line the owner brought from elsewhere is not ours to detach, and clearing the
      // order marker is what lets a returning business buy a fresh number.
      actions.push({ kind: "detach", businessId: b.id, businessName: b.name, number: b.voicePhoneNumber });
      report.detached.push(`${b.name} ${b.voicePhoneNumber}`);
    }
  }

  if (balance && balance.balance < due) {
    report.shortfall = { balance: balance.balance, due, currency: balance.currency, firstExpiry };
  }

  return { actions, report };
}

function hasSomethingToSay(r: RenewalReport): boolean {
  return (
    Boolean(r.shortfall) || r.atRisk.length > 0 || r.dead.length > 0 || r.orphans.length > 0 ||
    r.released.length > 0 || r.restored.length > 0 || r.detached.length > 0 || r.prolonged.length > 0
  );
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
  if (r.restored.length) parts.push(`<h3 style="color:#fff;">Parked lines bought back (business paying again)</h3><ul style="color:#a1a1aa;">${li(r.restored)}</ul>`);
  if (r.released.length) parts.push(`<h3 style="color:#fff;">Autorenew switched off (${NUMBER_GRACE_DAYS}-day hold over)</h3><ul style="color:#a1a1aa;">${li(r.released)}</ul>`);
  if (r.detached.length) parts.push(`<h3 style="color:#fff;">Numbers gone from the carrier, taken off their businesses</h3><ul style="color:#a1a1aa;">${li(r.detached)}</ul>`);
  if (r.prolonged.length) parts.push(`<h3 style="color:#fff;">Prepaid a month</h3><ul style="color:#a1a1aa;">${li(r.prolonged)}</ul>`);
  if (r.held.length) parts.push(`<p style="color:#a1a1aa;">Held for businesses that stopped paying (Tori pays): ${r.held.join("; ")}</p>`);
  if (r.repaired.length) parts.push(`<p style="color:#a1a1aa;">Autorenew switched on for: ${r.repaired.join(", ")}</p>`);
  return parts.join("");
}

const fmtHe = (d: Date | null) =>
  d ? d.toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "long", year: "numeric" }) : "";

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
    select: {
      id: true, name: true, voicePhoneNumber: true, voiceNumberOrderedAt: true,
      subscriptionStatus: true, subscriptionLapsedAt: true, blockedAt: true,
    },
  });

  const { actions, report } = planVoiceNumberRenewal(numbers, businesses, balance, new Date());

  for (const a of actions) {
    switch (a.kind) {
      case "persist":
        await prisma.business
          .update({ where: { id: a.businessId }, data: { voiceNumberStopDate: a.stopDate, voiceNumberAutorenew: a.autorenew } })
          .catch((err) => console.error("[voiceNumberRenewal] Could not persist carrier state:", err));
        continue;
      case "stamp":
        await prisma.business
          .update({ where: { id: a.businessId }, data: { subscriptionLapsedAt: a.lapsedAt } })
          .catch((err) => console.error("[voiceNumberRenewal] Could not stamp the lapse date:", err));
        continue;
      case "detach":
        // The order marker goes too: it is what refuses a second order, and the number it recorded
        // no longer exists. voiceNumberStopDate/autorenew describe a line that is gone.
        await prisma.business
          .update({
            where: { id: a.businessId },
            data: { voicePhoneNumber: null, voiceNumberOrderedAt: null, voiceNumberStopDate: null, voiceNumberAutorenew: null },
          })
          .then(() => console.log(`[voiceNumberRenewal] detached ${a.number} from ${a.businessName} — gone from the carrier`))
          .catch((err) => console.error("[voiceNumberRenewal] Could not detach a dead number:", err));
        continue;
      case "restore":
        try {
          const r = await prolongNumber(a.number, 1);
          console.log(`[voiceNumberRenewal] bought back parked ${a.number} for ${a.businessName}, until ${fmtDate(r.stopDate)}`);
        } catch (err) {
          const why = err instanceof Error ? err.message : String(err);
          report.atRisk.push(`${a.businessName} ${a.number} — parked at the carrier and could not be bought back (${why}); gone in days`);
        }
        continue;
      case "release-notice":
        // Once, on the day autorenew is switched off. The dunning message promised the month; this
        // is its end, with the one date that still matters: when the line actually stops.
        await notifyOwner(
          a.businessId,
          `חלפו ${NUMBER_GRACE_DAYS} יום בלי חידוש של המנוי לתורי, ולכן המספר ${a.number} משתחרר` +
            (a.stopDate ? ` ב-${fmtHe(a.stopDate)}` : "") +
            `. אחרי התאריך הזה הוא לא יחזור אלינו, והוואטסאפ והבוט הקולי שעליו יפסיקו לעבוד. חידוש לפני כן משאיר הכול כפי שהוא.`
        ).catch((err) => console.error("[voiceNumberRenewal] Release notice failed:", err));
        continue;
      case "autorenew":
        break;
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
