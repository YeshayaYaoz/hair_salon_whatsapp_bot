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
/**
 * How many months a paying line is bought at a time. Zadarma's console prices three months below
 * three monthly renewals, and three months prepaid is also what unlocks SMS on a number. The job
 * buys one line first and reads what it was actually charged: a discount confirmed means every
 * line is bought this way as it comes up for renewal; full price means the first is kept (it is
 * paid, not lost) and nothing else is prepaid — monthly autorenew is the same money then, with
 * less of it tied up. 1 turns this off.
 */
export const PREPAY_MONTHS = Math.max(1, Math.floor(Number(process.env.VOICE_NUMBER_PREPAY_MONTHS ?? 3)) || 3);
const PREPAY_MARKER_KEY = "voice_number_prepay";

export type PrepayState = "untested" | "discounted" | "full-price";
export interface PrepayPolicy {
  months: number;
  state: PrepayState;
}
const NO_PREPAY: PrepayPolicy = { months: 1, state: "untested" };

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
  /** Buy a paying line for several months at once, days before it would renew monthly. */
  | { kind: "prepay"; number: string; businessId: string; businessName: string; months: number; monthlyFee: number }
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
  /** Bought for several months at once, with what the carrier actually charged. */
  prepaid: string[];
  /** Lines due for a multi-month purchase that the balance could not fund without starving another. */
  prepaySkipped: string[];
  /** Set once, the day the carrier charged full price for a multi-month purchase. */
  prepayFullPrice: string | null;
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
  now: Date,
  prepay: PrepayPolicy = NO_PREPAY
): RenewalPlan {
  const byNumber = new Map<string, NumberBusiness>();
  for (const b of businesses) if (b.voicePhoneNumber) byNumber.set(digits(b.voicePhoneNumber), b);

  const actions: RenewalAction[] = [];
  const report: RenewalReport = {
    repaired: [], held: [], released: [], restored: [], detached: [], prolonged: [],
    prepaid: [], prepaySkipped: [], prepayFullPrice: null, atRisk: [], orphans: [], dead: [], shortfall: null,
  };
  const seen = new Set<string>();
  let due = 0;
  let firstExpiry: Date | null = null;
  /** Paying lines inside the renewal window — the ones worth buying for several months. */
  const prepayCandidates: Array<{ n: ZadarmaNumber; biz: NumberBusiness }> = [];

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
      } else if (daysLeft !== null && daysLeft <= RENEW_AHEAD_DAYS) {
        prepayCandidates.push({ n, biz });
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

  // Multi-month purchases, decided only once everything due this month is known: a line is bought
  // ahead only if what is left afterwards still covers every other line's renewal, so prepaying
  // one salon can never be what takes another salon's phone down. Earliest expiry first. Until the
  // carrier's price is known, one line per run — the purchase is also the price check.
  if (prepay.months > 1 && prepay.state !== "full-price") {
    let left = balance?.balance ?? null;
    prepayCandidates.sort((a, b) => (a.n.stopDate?.getTime() ?? 0) - (b.n.stopDate?.getTime() ?? 0));
    for (const { n, biz } of prepayCandidates) {
      const cost = prepay.months * n.monthlyFee; // the most it can be; the carrier may charge less
      const othersDue = due - n.monthlyFee;
      if (left !== null && left - cost < othersDue) {
        report.prepaySkipped.push(
          `${biz.name} ${n.number} — ${prepay.months} months is up to ${cost} ${n.currency}; balance ${left} must keep ${othersDue} for the other lines`
        );
        continue;
      }
      actions.push({ kind: "prepay", number: n.number, businessId: biz.id, businessName: biz.name, months: prepay.months, monthlyFee: n.monthlyFee });
      if (left !== null) left -= cost;
      due -= n.monthlyFee; // bought ahead, so no longer due this month
      if (prepay.state === "untested") break;
    }
    if (balance && left !== null) balance = { ...balance, balance: left };
  }

  if (balance && balance.balance < due) {
    report.shortfall = { balance: balance.balance, due, currency: balance.currency, firstExpiry };
  }

  return { actions, report };
}

function hasSomethingToSay(r: RenewalReport): boolean {
  return (
    Boolean(r.shortfall) || r.atRisk.length > 0 || r.dead.length > 0 || r.orphans.length > 0 ||
    r.released.length > 0 || r.restored.length > 0 || r.detached.length > 0 || r.prolonged.length > 0 ||
    r.prepaid.length > 0 || Boolean(r.prepayFullPrice)
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
  if (r.prepayFullPrice) {
    parts.push(
      `<h3 style="color:#fff;">No discount for buying ${PREPAY_MONTHS} months at once</h3>` +
        `<p style="color:#a1a1aa;"><code>${r.prepayFullPrice}</code><br>Nothing else will be bought ahead; monthly autorenew costs the same with less tied up. ` +
        `Set VOICE_NUMBER_PREPAY_MONTHS=1 to silence this, or delete the <code>${PREPAY_MARKER_KEY}</code> setting to try again.</p>`
    );
  }
  if (r.prepaid.length) parts.push(`<h3 style="color:#fff;">Bought ${PREPAY_MONTHS} months at once</h3><ul style="color:#a1a1aa;">${li(r.prepaid)}</ul>`);
  if (r.prepaySkipped.length) parts.push(`<h3 style="color:#fff;">Not bought ahead — balance would not cover the other lines</h3><ul style="color:#a1a1aa;">${li(r.prepaySkipped)}</ul>`);
  if (r.held.length) parts.push(`<p style="color:#a1a1aa;">Held for businesses that stopped paying (Tori pays): ${r.held.join("; ")}</p>`);
  if (r.repaired.length) parts.push(`<p style="color:#a1a1aa;">Autorenew switched on for: ${r.repaired.join(", ")}</p>`);
  return parts.join("");
}

const fmtHe = (d: Date | null) =>
  d ? d.toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "long", year: "numeric" }) : "";

/** What earlier runs learned about multi-month pricing, kept across restarts. */
async function readPrepayPolicy(): Promise<PrepayPolicy> {
  if (PREPAY_MONTHS <= 1) return NO_PREPAY;
  const row = await prisma.systemSetting.findUnique({ where: { key: PREPAY_MARKER_KEY } }).catch(() => null);
  let state: PrepayState = "untested";
  if (row) {
    try {
      const parsed = JSON.parse(row.value) as { state?: PrepayState; months?: number };
      // A verdict for a different length (the env var changed) is not a verdict for this one.
      if (parsed.months === PREPAY_MONTHS && (parsed.state === "discounted" || parsed.state === "full-price")) state = parsed.state;
    } catch {
      /* unreadable marker — test again */
    }
  }
  return { months: PREPAY_MONTHS, state };
}

async function writePrepayPolicy(state: PrepayState, perMonth: number, currency: string): Promise<void> {
  const value = JSON.stringify({ state, months: PREPAY_MONTHS, perMonth, currency, at: new Date().toISOString() });
  await prisma.systemSetting
    .upsert({ where: { key: PREPAY_MARKER_KEY }, create: { key: PREPAY_MARKER_KEY, value }, update: { value } })
    .catch((err) => console.error("[voiceNumberRenewal] Could not store the prepay verdict:", err));
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
    select: {
      id: true, name: true, voicePhoneNumber: true, voiceNumberOrderedAt: true,
      subscriptionStatus: true, subscriptionLapsedAt: true, blockedAt: true,
    },
  });

  const prepay = await readPrepayPolicy();
  const { actions, report } = planVoiceNumberRenewal(numbers, businesses, balance, new Date(), prepay);

  for (const a of actions) {
    switch (a.kind) {
      case "persist":
        await prisma.business
          .update({ where: { id: a.businessId }, data: { voiceNumberStopDate: a.stopDate, voiceNumberAutorenew: a.autorenew } })
          .catch((err) => console.error("[voiceNumberRenewal] Could not persist carrier state:", err));
        continue;
      case "prepay": {
        let r: Awaited<ReturnType<typeof prolongNumber>>;
        try {
          r = await prolongNumber(a.number, a.months);
        } catch (err) {
          const why = err instanceof Error ? err.message : String(err);
          report.prepaySkipped.push(`${a.businessName} ${a.number} — carrier refused the ${a.months}-month purchase (${why}); monthly autorenew stands`);
          continue;
        }
        const perMonth = r.totalPaid / a.months;
        const line = `${a.businessName} ${a.number} — paid ${r.totalPaid} ${r.currency} for ${a.months} months (${perMonth.toFixed(2)}/month vs ${a.monthlyFee} monthly), now until ${fmtDate(r.stopDate)}`;
        // The verdict, from the only source that has it: the charge itself. Zero means the carrier
        // reported nothing usable, which is not a verdict either way.
        if (r.totalPaid > 0 && perMonth < a.monthlyFee) {
          report.prepaid.push(line);
          if (prepay.state !== "discounted") await writePrepayPolicy("discounted", perMonth, r.currency);
        } else if (r.totalPaid > 0) {
          report.prepayFullPrice = line;
          await writePrepayPolicy("full-price", perMonth, r.currency);
        } else {
          report.prepaid.push(`${line} — charge not reported, price still unknown`);
        }
        await prisma.business
          .update({ where: { id: a.businessId }, data: { voiceNumberStopDate: r.stopDate } })
          .catch((err) => console.error("[voiceNumberRenewal] Could not persist the new stop date:", err));
        continue;
      }
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
