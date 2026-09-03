import { prisma } from "./prisma.js";
import { createMessageTemplate, getWabaId, type CreateTemplateResult } from "../webhook/whatsappClient.js";
import { captureError } from "./errorMonitoring.js";
import {
  reminderTemplate,
  reviewTemplate,
  confirmationTemplate,
  ownerAlertTemplate,
  wordingFor,
  OWNER_ALERT_TEXT,
  ownerAlertCtaTemplate,
  OWNER_ALERT_CTA_BODY,
  OWNER_ALERT_CTA_EXAMPLE,
  OWNER_ALERT_CTA_BUTTON,
} from "./whatsappTemplates.js";

/**
 * Submits the reminder + review templates to a business's own WABA.
 *
 * Extracted so it can run automatically the moment a number is connected, not only when the owner
 * finds the button. The cost of it being manual was invisible and permanent: Meta takes ~24h to
 * approve, and until then every reminder outside the 24-hour customer-service window is dropped —
 * scheduledMessages marks reminderSentAt anyway ("retrying next hour would only hit the same
 * wall"), so the reminder is not delayed, it is lost, and only a console.warn records it.
 *
 * Never throws: template submission failing must not fail the WhatsApp connection that just
 * succeeded. The owner can still retry from the button, which is now a retry rather than the only
 * path.
 */
export async function submitWhatsAppTemplates(
  businessId: string,
  phoneNumberId: string,
  accessToken: string,
  knownWabaId: string | null
): Promise<CreateTemplateResult[] | null> {
  try {
    let wabaId = knownWabaId ?? undefined;
    if (!wabaId) {
      wabaId = await getWabaId(phoneNumberId, accessToken);
      await prisma.business.update({ where: { id: businessId }, data: { whatsappWabaId: wabaId } });
    }
    const reminder = reminderTemplate();
    const review = reviewTemplate();
    const confirmation = confirmationTemplate();
    const ownerAlert = ownerAlertTemplate();
    const ownerAlertCta = ownerAlertCtaTemplate();

    // A zimmer has no "תור" and sells no "תספורת". Same template names and same variable order —
    // the sending code passes positional parameters and knows nothing about wording — but a guest
    // reading "התור שלך לתספורת" concludes the message reached the wrong person, and Meta reviews
    // the wording against the business it is submitted for.
    const { businessType } = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { businessType: true },
    });
    const wording = wordingFor(businessType);

    return await Promise.all([
      createMessageTemplate(wabaId, accessToken, { name: reminder.name, languageCode: reminder.languageCode, bodyText: wording.reminder.body, bodyExample: wording.reminder.example }),
      createMessageTemplate(wabaId, accessToken, { name: review.name, languageCode: review.languageCode, bodyText: wording.review.body, bodyExample: wording.review.example }),
      // Added late: a booking taken by phone had no written confirmation, and an owner alert sent
      // outside the owner's own 24h window had no template to fall back on — which is how a live
      // call's lead reached nobody while every layer reported success.
      createMessageTemplate(wabaId, accessToken, { name: confirmation.name, languageCode: confirmation.languageCode, bodyText: wording.confirmation.body, bodyExample: wording.confirmation.example }),
      createMessageTemplate(wabaId, accessToken, { name: ownerAlert.name, languageCode: ownerAlert.languageCode, bodyText: OWNER_ALERT_TEXT.body, bodyExample: OWNER_ALERT_TEXT.example }),
      // The owner alert again, with a button to the dashboard. Filed alongside the plain one rather
      // than instead of it: every business connected before this existed has only the plain one
      // approved, and notifyOwner falls back to it — so both have to be on the WABA for the ladder
      // to have a rung to land on.
      createMessageTemplate(wabaId, accessToken, {
        name: ownerAlertCta.name,
        languageCode: ownerAlertCta.languageCode,
        bodyText: OWNER_ALERT_CTA_BODY,
        bodyExample: OWNER_ALERT_CTA_EXAMPLE,
        urlButton: OWNER_ALERT_CTA_BUTTON,
      }),
    ]);
  } catch (err) {
    console.error(`[whatsapp] Automatic template submission failed for ${businessId} (non-fatal):`, err);
    captureError(err, { businessId, phase: "auto_submit_templates" });
    return null;
  }
}

