/**
 * Catches replies to Tori's own cold-outreach WhatsApp number.
 *
 * Outreach goes out from Tori's own WABA (TORI_OUTREACH_PHONE_NUMBER_ID), not from any salon's
 * number. The inbound webhook resolves a business by phone_number_id, and no Business row owns the
 * outreach number — so every reply used to hit "No business configured" and get dropped. A lead
 * answering "כן, אני מעוניין" reached a log line and nothing else, which is the worst possible
 * failure for the one message in the funnel that costs money to produce.
 *
 * Nothing here replies to the lead. A cold prospect saying yes should reach a human, and an
 * auto-answer from the same system that just cold-messaged them is what makes the whole thing feel
 * automated. This records the reply and alerts the operator; the conversation continues by hand.
 */
import { prisma } from "../lib/prisma.js";
import { sendAdminAlertEmail } from "../lib/email.js";
import { esc } from "../lib/emailLayout.js";

/**
 * Opt-out phrases, matched against the whole message.
 *
 * Deliberately not a substring search: "לא מעוניין" appears inside "אני כן מעוניין, לא מעוניין
 * לשלם מראש", and treating that as an opt-out would silently drop a lead who said yes. A real
 * opt-out is short and unambiguous, so anything longer goes to a human instead.
 */
const OPT_OUT_PHRASES = ["הסר", "הסירו", "להסיר", "לא מעוניין", "לא מעוניינת", "לא רלוונטי", "stop", "unsubscribe"];

/** Interest phrases — used only to label the alert, never to act on the lead's behalf. */
const INTEREST_PHRASES = ["כן", "מעוניין", "מעוניינת", "אשמח", "פרטים", "מעניין"];

export function classifyReply(text: string): "opt_out" | "interested" | "other" {
  const normalized = text.trim().toLowerCase().replace(/[!.,?׃…"'״׳]/gu, "");
  if (OPT_OUT_PHRASES.some((p) => normalized === p || normalized === `${p} תודה`)) return "opt_out";
  if (INTEREST_PHRASES.some((p) => normalized === p || normalized.startsWith(`${p} `) || normalized.startsWith(`${p},`)))
    return "interested";
  return "other";
}

/**
 * Google Places phones arrive formatted ("04-123-4567", "+972 4-123-4567") while WhatsApp sends
 * bare digits with a country code ("97241234567"). Comparing the last 9 digits matches across both
 * without a full parse, since Israeli subscriber numbers are 9 digits after the country code.
 */
export function phoneKey(raw: string): string {
  return raw.replace(/\D/g, "").slice(-9);
}

/** Is this inbound message addressed to our outreach number rather than a salon's? */
export function isOutreachNumber(phoneNumberId: string): boolean {
  const configured = process.env.TORI_OUTREACH_PHONE_NUMBER_ID;
  return Boolean(configured) && phoneNumberId === configured;
}

/**
 * Records a reply to cold outreach. Returns true when the message was handled here and the caller
 * should stop — the outreach number has no business, so falling through would only log a warning.
 *
 * Handled even when no lead matches: a reply to our outreach number is worth surfacing whether or
 * not we can attribute it (the owner may answer from a mobile that isn't the listed business line,
 * which is common), and silently discarding it is the exact failure this module exists to fix.
 */
export async function handleOutreachReply(fromPhone: string, text: string): Promise<boolean> {
  const key = phoneKey(fromPhone);
  const kind = classifyReply(text);

  // No phone index on Lead, and formats vary too much for an equality match, so the candidate set
  // is narrowed in SQL by the trailing digits and confirmed in code.
  const candidates = await prisma.lead.findMany({
    where: { phone: { not: null } },
    select: { id: true, name: true, phone: true, status: true, campaignId: true },
  });
  const lead = candidates.find((l) => phoneKey(l.phone!) === key) ?? null;

  if (lead) {
    if (kind === "opt_out") {
      await prisma.consentLog.create({ data: { leadId: lead.id, event: "opted_out", channel: "whatsapp" } });
    }
    // "replied" and "not_interested" are the operator's own funnel statuses; advancing them from a
    // real inbound message is exactly what they're for. Later statuses (meeting_scheduled,
    // converted) are never walked backwards by an automated reply.
    const nextStatus = kind === "opt_out" ? "not_interested" : "replied";
    if (lead.status === "new" || lead.status === "contacted") {
      await prisma.$transaction([
        prisma.lead.update({ where: { id: lead.id }, data: { status: nextStatus } }),
        prisma.leadStatusEvent.create({
          data: {
            leadId: lead.id,
            fromStatus: lead.status,
            toStatus: nextStatus,
            note: `תשובה בוואטסאפ: ${text.slice(0, 200)}`,
          },
        }),
      ]);
    }
  }

  const who = lead ? `${lead.name}` : `מספר לא מזוהה (${fromPhone})`;
  const heading =
    kind === "opt_out" ? "בקשת הסרה מתפוצה" : kind === "interested" ? "ליד ענה — מתעניין" : "ליד ענה להודעת התפוצה";
  await sendAdminAlertEmail(
    `${heading}: ${who}`,
    `<strong>${esc(who)}</strong> השיב/ה להודעת התפוצה בוואטסאפ:<br/><br/>“${esc(text.slice(0, 500))}”` +
      (lead ? "" : "<br/><br/>לא נמצא ליד עם המספר הזה — ייתכן שהתשובה הגיעה ממספר אחר של אותו עסק.")
  );

  console.log(`[leadfinder] Outreach reply from ${fromPhone} (${kind}), lead=${lead?.id ?? "unmatched"}`);
  return true;
}
