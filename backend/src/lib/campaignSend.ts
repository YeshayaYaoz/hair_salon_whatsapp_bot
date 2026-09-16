import { prisma } from "./prisma.js";
import { decryptSecret } from "./crypto.js";
import { normalizePhone } from "./phone.js";
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "../webhook/whatsappClient.js";
import { meterOutboundMessage } from "./wallet.js";
import { CAMPAIGN_TEMPLATE_LANG, type CampaignTemplateDef } from "./whatsappTemplates.js";

/**
 * Sends one marketing message from a business to many of its customers, and records what happened
 * to each — the single path every campaign in the codebase goes through.
 *
 * It exists because the yield campaign did this by hand and got every part of it wrong at once: it
 * sent free-form text to customers who by definition had not written in sixty days, so every one
 * of them was outside the 24-hour window; Meta returned 200 for each and dropped each; the loop
 * counted `sent++` and the owner was told twelve offers had gone out. None had. It also had no
 * opt-out, which for a marketing message is both a Meta policy problem and, in Israel, a legal one.
 *
 * What this does instead, per recipient, in order:
 *   1. Skips anyone who has opted out of this business's marketing.
 *   2. If the customer's 24h window is open, sends the rendered text as a plain message — no
 *      template needed, and it is the cheaper conversation at Meta.
 *   3. Otherwise sends the library template with [first name, business name, owner's text].
 *   4. Records a CampaignSend row carrying Meta's message id, so the status webhook can turn
 *      "accepted" into "delivered" or "failed" later. The count an owner is shown comes from those
 *      rows (campaignReport), never from this loop.
 *   5. Meters the send against the plan quota / wallet, like every other proactive message.
 */

/** Hard ceiling per campaign. A business's number is what its bookings run on, and Meta's quality
 * rating for it falls with spam reports; a hundred offers at once is how a salon loses its line. */
export const MAX_CAMPAIGN_RECIPIENTS = 50;

/** Half an hour under Meta's 24h, same slack as ownerNotify. */
const WINDOW_MS = 23.5 * 60 * 60 * 1000;

/** Gap between sends. One number messaging many people who did not write first is the exact shape
 * WhatsApp scores as spam; pacing is the cheapest thing that makes it look less like one. */
const SEND_GAP_MS = 400;

export interface CampaignRecipient {
  id: string;
  phone: string;
  name: string | null;
  marketingOptOutAt: Date | null;
}

export interface RunCampaignParams {
  businessId: string;
  source: "yield" | "manager";
  audience: "lapsed" | "all" | "selected";
  template: CampaignTemplateDef;
  /** The owner's own words — what goes into the template's {{3}}. */
  ownerText: string;
  /** For a copyCode template: the code on the button. Ignored by templates without one. */
  couponCode?: string;
  recipients: CampaignRecipient[];
}

export interface CampaignOutcome {
  campaignId: string;
  /** Meta accepted the request. NOT delivered — see campaignReport for that. */
  accepted: number;
  skippedOptOut: number;
  refused: number;
  viaSession: number;
  viaTemplate: number;
  /** Recipients dropped because the list was longer than MAX_CAMPAIGN_RECIPIENTS. */
  capped: number;
}

/** First name only — "היי דנה", not "היי דנה כהן-לוי". Falls back to a bare greeting. */
function firstName(name: string | null): string {
  const first = name?.trim().split(/\s+/)[0];
  return first || "היי";
}

/**
 * The template body with its variables filled — the same words whichever channel carries them.
 *
 * A plain session message has no button, so for a coupon template the code goes on its own line
 * at the end; the customer still gets the code, just without the tap-to-copy.
 */
export function renderCampaignText(template: CampaignTemplateDef, params: [string, string, string], couponCode?: string): string {
  const body = params.reduce<string>((acc, value, i) => acc.split(`{{${i + 1}}}`).join(value), template.body);
  return template.copyCode && couponCode ? `${body}\n\nהקוד: ${couponCode}` : body;
}

/** Whether a customer wrote to this business on WhatsApp within the window. Only WhatsApp opens a
 * WhatsApp window — a phone call's transcript lives in the same table and must not count. */
async function hasOpenWindow(businessId: string, phone: string): Promise<boolean> {
  const inbound = await prisma.conversationMessage.findFirst({
    where: {
      businessId,
      phone: normalizePhone(phone),
      role: "user",
      channel: "whatsapp",
      createdAt: { gte: new Date(Date.now() - WINDOW_MS) },
    },
    select: { id: true },
  });
  return Boolean(inbound);
}

export async function runCampaign(params: RunCampaignParams): Promise<CampaignOutcome> {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: params.businessId },
    select: { name: true, whatsappPhoneNumberId: true, whatsappAccessToken: true },
  });
  if (!business.whatsappPhoneNumberId || !business.whatsappAccessToken) {
    throw new Error("WhatsApp is not connected for this business");
  }
  const accessToken = decryptSecret(business.whatsappAccessToken);

  const eligible = params.recipients.filter((r) => !r.marketingOptOutAt);
  const skippedOptOut = params.recipients.length - eligible.length;
  const batch = eligible.slice(0, MAX_CAMPAIGN_RECIPIENTS);
  const capped = eligible.length - batch.length;

  const campaign = await prisma.campaign.create({
    data: {
      businessId: params.businessId,
      source: params.source,
      templateName: params.template.name,
      ownerText: params.ownerText,
      audience: params.audience,
    },
  });

  const outcome: CampaignOutcome = {
    campaignId: campaign.id,
    accepted: 0,
    skippedOptOut,
    refused: 0,
    viaSession: 0,
    viaTemplate: 0,
    capped,
  };

  for (const recipient of batch) {
    const bodyParams: [string, string, string] = [firstName(recipient.name), business.name, params.ownerText];
    const viaSession = await hasOpenWindow(params.businessId, recipient.phone);
    try {
      const receipt = viaSession
        ? await sendWhatsAppMessage({
            phoneNumberId: business.whatsappPhoneNumberId,
            accessToken,
            to: recipient.phone,
            text: renderCampaignText(params.template, bodyParams, params.couponCode),
          })
        : await sendWhatsAppTemplate({
            phoneNumberId: business.whatsappPhoneNumberId,
            accessToken,
            to: recipient.phone,
            templateName: params.template.name,
            languageCode: CAMPAIGN_TEMPLATE_LANG,
            bodyParams,
            ...(params.template.copyCode && params.couponCode ? { copyCode: params.couponCode } : {}),
          });

      await prisma.campaignSend.create({
        data: {
          campaignId: campaign.id,
          customerId: recipient.id,
          phone: recipient.phone,
          messageId: receipt.messageId ?? null,
          channel: viaSession ? "session" : "template",
        },
      });
      outcome.accepted++;
      if (viaSession) outcome.viaSession++;
      else outcome.viaTemplate++;

      // Non-fatal: metering failing must not cost the next recipient their message.
      await meterOutboundMessage(params.businessId).catch((err) =>
        console.error(`[campaign] Could not meter send to ${recipient.phone} (non-fatal):`, err)
      );
    } catch (err) {
      // Refused at the send API itself (bad number, template not approved on this WABA). Recorded
      // as failed with no message id, so the report counts it rather than the row simply not
      // existing — a campaign that "reached 3 of 3" because 9 rows were never written is the lie
      // this whole file exists to stop.
      outcome.refused++;
      console.error(`[campaign] Send to ${recipient.phone} refused:`, err instanceof Error ? err.message : err);
      await prisma.campaignSend
        .create({
          data: {
            campaignId: campaign.id,
            customerId: recipient.id,
            phone: recipient.phone,
            status: "failed",
            channel: viaSession ? "session" : "template",
          },
        })
        .catch(() => {});
    }
    await new Promise((r) => setTimeout(r, SEND_GAP_MS));
  }

  return outcome;
}

export interface CampaignReport {
  campaignId: string;
  total: number;
  delivered: number; // delivered or read
  read: number;
  failed: number;
  /** Accepted by Meta, no status back yet. Shrinks over the minutes after a send. */
  pending: number;
}

/**
 * What actually happened, from the status webhook's writes.
 *
 * Meant to be read a little after the send — statuses arrive over the following minutes. Read
 * immediately, everything is still pending, and that is the honest answer at that moment.
 */
export async function campaignReport(campaignId: string): Promise<CampaignReport> {
  const rows = await prisma.campaignSend.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });
  const count = (status: string) => rows.find((r) => r.status === status)?._count._all ?? 0;
  const read = count("read");
  const delivered = count("delivered") + read;
  const failed = count("failed");
  const pending = count("sent");
  return { campaignId, total: delivered + failed + pending, delivered, read, failed, pending };
}

/**
 * Which customers a campaign goes to.
 *
 * "lapsed": has been in at least once, nothing in the last LAPSED_DAYS, nothing upcoming — the
 * people a "come back" message is for. "all": everyone who has ever written or booked. Both exclude
 * nobody on opt-out grounds here; runCampaign does that, so the skipped count is reported.
 */
export const LAPSED_DAYS = 60;

export async function selectAudience(businessId: string, audience: "lapsed" | "all"): Promise<CampaignRecipient[]> {
  const select = { id: true, phone: true, name: true, marketingOptOutAt: true };
  if (audience === "all") {
    return prisma.customer.findMany({ where: { businessId }, select, orderBy: { name: "asc" } });
  }
  const cutoff = new Date(Date.now() - LAPSED_DAYS * 24 * 60 * 60 * 1000);
  return prisma.customer.findMany({
    where: {
      businessId,
      appointments: {
        some: { status: "confirmed", startTime: { lt: cutoff } },
        none: { status: { in: ["confirmed", "pending_payment"] }, startTime: { gte: cutoff } },
      },
    },
    select,
    orderBy: { name: "asc" },
  });
}
