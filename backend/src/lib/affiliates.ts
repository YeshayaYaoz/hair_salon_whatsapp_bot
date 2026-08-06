import { prisma } from "./prisma.js";
import { sendAdminAlertEmail } from "./email.js";

/**
 * Affiliate referrals: salons we send to a provider's own signup page through our partner link.
 *
 * Only surfaced to salons that have nothing connected yet, where the alternative is not "a
 * different provider" but "no card payments at all" — so the recommendation costs them nothing they
 * weren't already missing. A salon that already has a provider is never shown one.
 *
 * What we can and cannot observe is worth being precise about, because it decides what this file
 * is allowed to claim:
 *
 *  - The *signup itself* happens entirely on the provider's side. We never see it. Attribution is
 *    theirs to report, which is why the click carries `ref=<businessId>` — that is the sub-id their
 *    affiliate dashboard shows back, and the only way to match one of their rows to one of ours.
 *  - The *conversion we care about* — the salon connecting that provider here — is ours to see, and
 *    is what `markConverted` records and emails the operator about.
 *
 * There is no postback from the provider, so a signup that never gets connected here stays
 * invisible to us and shows up only in their dashboard.
 */

export const AFFILIATE_PROVIDERS = ["payplus"] as const;
export type AffiliateProvider = (typeof AFFILIATE_PROVIDERS)[number];

/** Which side of the product the referral was for — a salon may be referred for both. */
export const AFFILIATE_KINDS = ["payments", "invoice"] as const;
export type AffiliateKind = (typeof AFFILIATE_KINDS)[number];

/**
 * Records that a salon followed one of our affiliate links.
 *
 * Idempotent per (business, provider, kind): re-clicking refreshes the timestamp rather than
 * stacking rows, so "was this salon referred?" always has exactly one answer. A click is not a
 * conversion and deliberately does not alert anyone — that would be an email every time someone
 * opens a link out of curiosity.
 */
export async function recordAffiliateClick(
  businessId: string,
  provider: AffiliateProvider,
  kind: AffiliateKind
): Promise<void> {
  await prisma.affiliateReferral.upsert({
    where: { businessId_provider_kind: { businessId, provider, kind } },
    create: { businessId, provider, kind },
    update: { clickedAt: new Date() },
  });
}

/**
 * Called after a salon successfully connects a provider. If we referred them for this exact
 * provider and kind, and haven't already counted it, the referral converted — email the operator.
 *
 * Never throws: a failed alert must not fail the connection the salon just completed successfully.
 */
export async function markAffiliateConversion(params: {
  businessId: string;
  provider: string;
  kind: AffiliateKind;
}): Promise<void> {
  const { businessId, kind } = params;
  // PayPlus's invoicing product connects under its own provider id ("payplus-invoice"), but it is
  // the same company behind the same affiliate link — the invoice link is just the payments one
  // with &inv=true. Without this mapping every Invoice+ conversion would be missed.
  const provider = params.provider === "payplus-invoice" ? "payplus" : params.provider;
  if (!(AFFILIATE_PROVIDERS as readonly string[]).includes(provider)) return;

  try {
    const referral = await prisma.affiliateReferral.findUnique({
      where: { businessId_provider_kind: { businessId, provider, kind } },
    });
    // No referral, or already counted — either way there is nothing new to report. Checking
    // convertedAt is what stops a reconnect from emailing the same conversion twice.
    if (!referral || referral.convertedAt) return;

    await prisma.affiliateReferral.update({
      where: { id: referral.id },
      data: { convertedAt: new Date() },
    });

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true, email: true },
    });

    const daysToConvert = Math.max(
      0,
      Math.round((Date.now() - referral.clickedAt.getTime()) / (24 * 60 * 60 * 1000))
    );
    const what = kind === "payments" ? "סליקה" : "חשבוניות";

    await sendAdminAlertEmail(
      `הפניית שותפים הבשילה — ${business?.name ?? businessId}`,
      `העסק <strong>${business?.name ?? businessId}</strong> (${business?.email ?? "—"}) ` +
        `חיבר עכשיו ${what} דרך <strong>${provider}</strong>, אחרי שהגיע לשם מקישור השותפים שלנו ` +
        `לפני ${daysToConvert} ימים.<br><br>` +
        `מזהה העסק לצורך התאמה בדשבורד השותפים של הספק: <code>${businessId}</code>`
    );
  } catch (err) {
    console.error("[affiliates] Failed to record conversion (non-fatal):", err);
  }
}
