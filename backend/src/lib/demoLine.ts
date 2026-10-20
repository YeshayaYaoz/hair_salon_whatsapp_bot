/**
 * The public demo on Tori's own line.
 *
 * The strongest sales asset this product has is the product: a prospect who watches the bot book
 * a haircut in thirty seconds needs no landing page. Until now the only way to see that was to
 * sign up, connect a number and wait for Meta — and the landing page's "talk to the bot" box was a
 * handful of regex replies pretending to be it.
 *
 * This makes one real business the demo. The operator creates it in the dashboard like any other
 * (services, hours, a greeting), leaves it on the shared line, and sets TORI_DEMO_BUSINESS_ID to
 * its id. A stranger who writes "דמו" to Tori's line, or follows a wa.me link that pre-fills it,
 * is then treated as that business's customer for the rest of the conversation: the real bot,
 * the real slot picker, the real booking. Nothing is special-cased in the bot itself.
 *
 * The routing lives in sharedLineRouting.ts, where the demo is one shared-line business among
 * the others; what is here is only what makes the demo different from them — the trigger word,
 * the operator alert, and the footer that says what the reader is looking at.
 */
import { prisma } from "./prisma.js";
import { Prisma } from "@prisma/client";
import { phoneKey } from "../leadfinder/inboundReplies.js";
import { sendAdminAlertEmail } from "./email.js";
import { esc } from "./emailLayout.js";

/** Where a demo sends people. The dashboard's own URL (APP_URL) is the site, with the public
 * domain as the fallback so a missing variable never puts "localhost" in a prospect's chat. */
export function siteUrl(): string {
  const configured = process.env.APP_URL?.trim().replace(/\/$/, "");
  return configured && !/localhost|127\.0\.0\.1/.test(configured) ? configured : "https://torionline.com";
}

export function demoBusinessId(): string | null {
  const id = process.env.TORI_DEMO_BUSINESS_ID?.trim();
  return id || null;
}

export function isDemoBusiness(businessId: string): boolean {
  const id = demoBusinessId();
  return Boolean(id) && businessId === id;
}

/** "דמו" / "demo" anywhere in the message. The wa.me link on the landing page pre-fills exactly
 * this, and a person who typed it by hand meant the same thing. */
export function isDemoTrigger(text: string): boolean {
  return /דמו|demo/i.test(text);
}

/**
 * Someone just started trying the demo. That phone number is the warmest lead in the pipeline,
 * so it goes to the operator at once, and if it belongs to a known lead the lead's own timeline
 * says so. Never throws: the demo reply must go out whether or not this bookkeeping succeeds.
 */
export async function noteDemoStarted(fromPhone: string, firstMessage: string): Promise<void> {
  try {
    const key = phoneKey(fromPhone);
    const rows = await prisma.$queryRaw<{ id: string; name: string; status: string }[]>(
      Prisma.sql`SELECT id, name, status FROM "Lead"
                 WHERE phone IS NOT NULL
                   AND RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 9) = ${key}
                 LIMIT 1`
    );
    const lead = rows[0] ?? null;
    if (lead) {
      const data: { status?: string } = {};
      // Same rule as a reply to outreach: only the early funnel statuses move on their own.
      if (lead.status === "new" || lead.status === "contacted") data.status = "replied";
      await prisma.$transaction([
        prisma.lead.update({ where: { id: lead.id }, data }),
        prisma.leadStatusEvent.create({
          data: { leadId: lead.id, fromStatus: lead.status, toStatus: data.status ?? lead.status, note: "ניסה/תה את הדמו בוואטסאפ" },
        }),
      ]);
    }
    const who = lead ? lead.name : `מספר לא מזוהה (${fromPhone})`;
    await sendAdminAlertEmail(
      `🤖 מישהו מנסה את הדמו: ${who}`,
      `<strong>${esc(who)}</strong> כתב/ה לקו של תורי והתחיל/ה שיחת דמו:<br/><br/>“${esc(firstMessage.slice(0, 300))}”` +
        `<br/><br/>מספר: ${esc(fromPhone)}. שווה טלפון היום, בזמן שזה חם.`
    );
  } catch (err) {
    console.error("[demo] Failed to record demo start (non-fatal):", err);
  }
}

/** Appended once, to the first reply of a demo conversation, so the person always learns what they
 * are looking at and where to get it. Hebrew and English because the trigger word is either. */
export function demoFooter(lang: "he" | "en"): string {
  const url = siteUrl();
  return lang === "he"
    ? `\n\n🤖 זו הדגמה של תורי. ככה זה עובד אצל הלקוחות של העסק שלכם, 24/7. רוצים? ${url}`
    : `\n\n🤖 This is a demo of Tori. This is what your own customers would get, 24/7. Want it? ${url}`;
}
