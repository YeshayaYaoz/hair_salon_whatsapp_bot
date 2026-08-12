import { prisma } from "../lib/prisma.js";
import { sendAdminAlertEmail } from "../lib/email.js";
import { esc } from "../lib/emailLayout.js";

/**
 * What happens after a template is submitted — which, until now, was nothing anyone could see.
 *
 * Connecting a business submits four templates automatically, and that is where the automation
 * stopped. Meta reviews them asynchronously and answers on a webhook nobody was listening to, so a
 * rejection was invisible in exactly the way that costs the most: the affected message keeps
 * "working" while the customer's 24h window is open, then silently stops being delivered once it
 * closes. Reminders and review requests almost always land outside that window, so a rejected
 * template means those features are dead for that business, with nothing anywhere saying so.
 *
 * The alert goes to the operator rather than the salon: nobody running a salon can act on
 * "INVALID_FORMAT on a template body", and the fix is a code change here, not something in their
 * dashboard. Which is the whole point — the operator gets told once and fixes it for every
 * business, instead of each business needing a person.
 *
 * Meta sends this on the `message_template_status_update` field, which the app must be subscribed
 * to in the Meta console; without that subscription this handler simply never runs, and the
 * previous silence continues.
 */

type TemplateStatusChange = {
  event?: string;
  message_template_name?: string;
  message_template_language?: string;
  reason?: string;
  /** Present on category changes rather than approvals — Meta reuses this field for both. */
  new_category?: string;
  previous_category?: string;
};

/** Which business a WABA-level event belongs to. WABA id is on the entry, not the value. */
async function businessForWaba(wabaId: string) {
  return prisma.business.findFirst({
    where: { whatsappWabaId: wabaId },
    select: { id: true, name: true, email: true },
  });
}

export async function handleTemplateStatusUpdate(wabaId: string, change: TemplateStatusChange): Promise<void> {
  const event = (change.event ?? "").toUpperCase();
  const name = change.message_template_name ?? "(unnamed)";
  const business = await businessForWaba(wabaId);
  const who = business ? `${business.name} (${business.id})` : `WABA ${wabaId}`;

  if (event === "APPROVED") {
    console.log(`[templates] ${who}: '${name}' approved`);
    return;
  }

  // Meta re-categorises UTILITY templates to MARKETING when it reads marketing intent, and that is
  // a pricing change, not a failure — MARKETING messages cost more and need opt-out handling. Worth
  // knowing about, not worth an alarm.
  if (event === "CATEGORY_CHANGE" || change.new_category) {
    console.warn(
      `[templates] ${who}: '${name}' recategorised ${change.previous_category ?? "?"} → ${change.new_category ?? "?"}`
    );
    return;
  }

  if (event !== "REJECTED" && event !== "PAUSED" && event !== "DISABLED") {
    console.log(`[templates] ${who}: '${name}' → ${event || "(no event)"}`);
    return;
  }

  const reason = change.reason ?? "no reason given";
  console.error(`[templates] ${who}: '${name}' ${event} — ${reason}`);

  await sendAdminAlertEmail(
    `⚠️ תבנית וואטסאפ ${event === "REJECTED" ? "נדחתה" : "הושבתה"} — ${business?.name ?? wabaId}`,
    `<strong>${esc(name)}</strong> (${esc(change.message_template_language ?? "?")}) — ${esc(event)}.<br/>` +
      `סיבה: ${esc(reason)}<br/><br/>` +
      `עד שזה יתוקן, ההודעות שמסתמכות על התבנית הזו לא נמסרות ללקוחות שחלון 24 השעות שלהם סגור — ` +
      `כלומר כמעט כולם. התיקון הוא בגוף התבנית ב-whatsappTemplates.ts, והוא חל על כל העסקים.`
  ).catch((err) => console.error("[templates] Could not alert the operator:", err));
}
