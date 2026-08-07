import { prisma } from "../lib/prisma.js";
import { decryptSecret } from "../lib/crypto.js";
import { depositCallbackUrl, getPaymentProvider } from "../lib/payments/index.js";
import { attachDepositPaymentLink } from "./availability.js";

/**
 * The deposit decision and the payment-link creation that follows it, shared by every channel that
 * can create a booking.
 *
 * This lives here because it did not: the WhatsApp bot implemented deposits inline
 * (bot/claudeBot.ts book_appointment) and the public booking page never implemented them at all, so
 * a salon that required a deposit gave away free confirmed slots through the booking link printed
 * on its own website. Anything that books has to ask the same question and get the same answer.
 */

/** The business fields the deposit decision depends on. */
export type DepositBusiness = {
  depositEnabled: boolean;
  depositAmountIls: number;
  depositHoldMinutes: number;
  paymentProvider: string | null;
  paymentApiKey: string | null;
  paymentApiSecret: string | null;
  paymentPageUid?: string | null;
  paymentWebhookSecret?: string | null;
};

/**
 * A deposit is required only if the owner opted in AND actually has a connected merchant account to
 * charge through. An enabled toggle with no provider must not silently block every booking — the
 * clinic and aesthetics templates switch `depositEnabled` on during onboarding, long before anyone
 * connects a provider, so this state is normal rather than exceptional.
 */
export function isDepositRequired(biz: DepositBusiness): boolean {
  return Boolean(
    biz.depositEnabled && biz.depositAmountIls > 0 && biz.paymentProvider && biz.paymentApiKey && biz.paymentApiSecret
  );
}

/** The extra `createAppointment` fields that turn a booking into an unpaid hold. */
export function depositHoldFields(biz: DepositBusiness) {
  return {
    status: "pending_payment" as const,
    depositAmountIls: biz.depositAmountIls,
    depositExpiresAt: new Date(Date.now() + biz.depositHoldMinutes * 60_000),
  };
}

/**
 * Creates the hosted payment link for a hold and records it on the appointment.
 *
 * On failure the caller must release the hold: a `pending_payment` row with no payment URL blocks
 * the slot for the full hold window with no way for anyone to pay it. `releaseHold` below is the
 * companion for that.
 */
export async function createDepositLink(params: {
  businessId: string;
  biz: DepositBusiness & { name: string };
  appointmentId: string;
  serviceName: string;
  customerName: string;
  customerPhone: string;
}): Promise<string> {
  const { biz, businessId, appointmentId, serviceName, customerName, customerPhone } = params;
  const provider = getPaymentProvider(biz.paymentProvider!);
  const creds =
    biz.paymentProvider === "tori_managed"
      ? { apiKey: "", apiSecret: "" }
      : {
          apiKey: decryptSecret(biz.paymentApiKey!),
          apiSecret: decryptSecret(biz.paymentApiSecret!),
          pageUid: biz.paymentPageUid ?? undefined,
        };

  const link = await provider.createPaymentLink(creds, {
    amountIls: biz.depositAmountIls,
    description: `מקדמה לתור — ${serviceName}, ${biz.name}`,
    customerName,
    customerPhone,
    referenceId: appointmentId,
    callbackUrl: depositCallbackUrl(businessId, biz.paymentProvider!, biz.paymentWebhookSecret ?? null) ?? undefined,
  });

  await attachDepositPaymentLink(appointmentId, {
    provider: biz.paymentProvider!,
    paymentUrl: link.paymentUrl,
    providerRef: link.providerTransactionId,
  });

  return link.paymentUrl;
}

/** Drops a hold whose payment link could not be created, so the slot returns to availability. */
export async function releaseHold(appointmentId: string): Promise<void> {
  await prisma.appointment.delete({ where: { id: appointmentId } }).catch(() => {});
}
