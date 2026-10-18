import { prisma } from "./prisma.js";
import { decryptSecret } from "./crypto.js";
import { getPaymentProvider, depositCallbackUrl } from "./payments/index.js";
import { sendingIdentity } from "./sendingIdentity.js";
import { sendWhatsAppMessage, sendWhatsAppTemplate, RE_ENGAGEMENT_ERROR_CODE, WhatsAppSendError } from "../webhook/whatsappClient.js";
import { paymentLinkTemplate } from "./whatsappTemplates.js";
import { fmtIls } from "./money.js";
import { issueAndSendReceipt, deliverReceipt, NoInvoiceProviderError, type DeliveryOutcome } from "./receipts.js";
import { resolveInvoiceCredentials } from "./invoices/index.js";
import { notifyOwner } from "./ownerNotify.js";
import { captureError } from "./errorMonitoring.js";

/**
 * "Send Uri a link for ₪300."
 *
 * The owner wants money from a customer for something that is not a deposit on a booking: a
 * treatment already given, a product, a balance. Until now the only payment link Tori could make
 * was the deposit hold's, and asking for any other produced a refusal the model dressed up as a
 * "glitch". This creates the link on the business's own provider, sends it to the customer, and
 * when the provider calls back, marks it paid and issues the receipt.
 */

export class NoPaymentProviderError extends Error {
  constructor() {
    super("This business has no payment provider connected.");
    this.name = "NoPaymentProviderError";
  }
}

const BUSINESS_SELECT = {
  id: true, name: true, paymentProvider: true, paymentApiKey: true, paymentApiSecret: true, paymentPageUid: true, paymentWebhookSecret: true,
  whatsappPhoneNumberId: true, whatsappAccessToken: true,
} as const;

export interface CreatedPaymentRequest {
  requestId: string;
  paymentUrl: string;
  delivery: DeliveryOutcome;
}

export async function createPaymentRequest(params: {
  businessId: string;
  customer: { id: string; name: string | null; phone: string };
  amountIls: number;
  description: string;
}): Promise<CreatedPaymentRequest> {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: params.businessId }, select: BUSINESS_SELECT });
  if (!business.paymentProvider || (business.paymentProvider !== "tori_managed" && (!business.paymentApiKey || !business.paymentApiSecret))) {
    throw new NoPaymentProviderError();
  }
  const provider = getPaymentProvider(business.paymentProvider);
  const creds =
    business.paymentProvider === "tori_managed"
      ? { apiKey: "", apiSecret: "" }
      : { apiKey: decryptSecret(business.paymentApiKey!), apiSecret: decryptSecret(business.paymentApiSecret!), pageUid: business.paymentPageUid ?? undefined };

  // The row first, so its id can ride on the link as the reference the callback echoes back.
  const row = await prisma.paymentRequest.create({
    data: { businessId: business.id, customerId: params.customer.id, amountIls: params.amountIls, description: params.description, paymentUrl: "" },
  });
  let link;
  try {
    link = await provider.createPaymentLink(creds, {
      amountIls: params.amountIls,
      description: `${params.description} — ${business.name}`,
      customerName: params.customer.name ?? undefined,
      customerPhone: params.customer.phone,
      referenceId: row.id,
      callbackUrl: depositCallbackUrl(business.id, business.paymentProvider, business.paymentWebhookSecret ?? null) ?? undefined,
    });
  } catch (err) {
    await prisma.paymentRequest.delete({ where: { id: row.id } }).catch(() => {});
    throw err;
  }
  await prisma.paymentRequest.update({ where: { id: row.id }, data: { paymentUrl: link.paymentUrl, providerRef: link.providerTransactionId } });

  const delivery = await deliverPaymentLink({ business, customer: params.customer, requestId: row.id, paymentUrl: link.paymentUrl, amountIls: params.amountIls, description: params.description });
  await prisma.paymentRequest.update({ where: { id: row.id }, data: { delivery } }).catch(() => {});
  return { requestId: row.id, paymentUrl: link.paymentUrl, delivery };
}

/** Plain text inside the 24h window, the approved template with a button outside it. */
export async function deliverPaymentLink(params: {
  business: { name: string; whatsappPhoneNumberId: string | null; whatsappAccessToken: string | null };
  customer: { name: string | null; phone: string };
  requestId: string;
  paymentUrl: string;
  amountIls: number;
  description: string;
}): Promise<DeliveryOutcome> {
  const identity = sendingIdentity(params.business);
  if (!identity) return "no_whatsapp";
  const common = { phoneNumberId: identity.phoneNumberId, accessToken: identity.accessToken, to: params.customer.phone, kind: "payment-link" as const };
  const first = params.customer.name?.trim().split(/\s+/)[0] || "שלום";
  try {
    await sendWhatsAppMessage({
      ...common,
      text: `היי ${first}, ${params.business.name} שלחו לך בקשת תשלום על ${params.description} בסך ₪${fmtIls(params.amountIls)}.\nלתשלום מאובטח: ${params.paymentUrl}`,
    });
    return "sent";
  } catch (err) {
    if (!(err instanceof WhatsAppSendError && err.code === RE_ENGAGEMENT_ERROR_CODE)) {
      console.error("[paymentRequests] Could not deliver the link:", err);
      captureError(err, { phase: "payment_link_delivery" });
      return "failed";
    }
  }
  const template = paymentLinkTemplate();
  try {
    await sendWhatsAppTemplate({
      ...common,
      templateName: template.name,
      languageCode: template.languageCode,
      bodyParams: [first, params.business.name, params.description, fmtIls(params.amountIls)],
      urlSuffix: params.requestId,
    });
    return "template";
  } catch (err) {
    console.warn("[paymentRequests] Template send failed, window closed:", err instanceof Error ? err.message : err);
    return "window_closed";
  }
}

/**
 * The provider says it was paid. Marks the request, tells the owner, and issues the receipt —
 * through the invoicing provider, or by recording the one PayPlus Invoice+ already issued during
 * the charge and reported in the callback.
 *
 * Returns false when the reference is not a pending request of this business, so the webhook can
 * carry on treating it as something else.
 */
export async function settlePaymentRequest(
  businessId: string,
  referenceId: string,
  event: { amountIls?: number; receiptUrl?: string }
): Promise<boolean> {
  const request = await prisma.paymentRequest.findFirst({
    where: { id: referenceId, businessId, status: "pending" },
    include: { customer: { select: { id: true, name: true, phone: true } } },
  });
  if (!request) return false;
  if (event.amountIls !== undefined && event.amountIls < request.amountIls) {
    console.warn(`[paymentRequests] ${request.id}: reported ₪${event.amountIls} below requested ₪${request.amountIls} — not settling`);
    return true;
  }
  await prisma.paymentRequest.update({ where: { id: request.id }, data: { status: "paid", paidAt: new Date() } });

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { name: true, invoiceProvider: true, invoiceApiKey: true, invoiceApiSecret: true, paymentProvider: true, paymentApiKey: true, paymentApiSecret: true, paymentPageUid: true, whatsappPhoneNumberId: true, whatsappAccessToken: true },
  });
  const who = request.customer.name ?? request.customer.phone;
  let receiptNote = "";
  try {
    const resolved = resolveInvoiceCredentials(business);
    if (resolved?.provider === "payplus-invoice" && event.receiptUrl) {
      // Already issued by PayPlus during the charge; record it and hand it to the customer.
      const row = await prisma.receipt.create({
        data: { businessId, customerId: request.customer.id, amountIls: request.amountIls, description: request.description, documentUrl: event.receiptUrl, delivery: "pending" },
      });
      const delivery = await deliverReceipt({ business, customerPhone: request.customer.phone, customerName: request.customer.name, receiptId: row.id, documentUrl: event.receiptUrl, amountIls: request.amountIls, description: request.description });
      await prisma.receipt.update({ where: { id: row.id }, data: { delivery } }).catch(() => {});
      await prisma.paymentRequest.update({ where: { id: request.id }, data: { receiptId: row.id } });
      receiptNote = `\nקבלה: ${event.receiptUrl}`;
    } else if (resolved && resolved.provider !== "payplus-invoice") {
      const receipt = await issueAndSendReceipt({
        businessId, amountIls: request.amountIls, description: request.description,
        customerName: request.customer.name?.trim() || "לקוח", customerPhone: request.customer.phone, customerId: request.customer.id,
      });
      await prisma.paymentRequest.update({ where: { id: request.id }, data: { receiptId: receipt.receiptId } });
      receiptNote = `\nקבלה: ${receipt.documentUrl}`;
    } else if (resolved?.provider === "payplus-invoice") {
      receiptNote = "\nהקבלה מונפקת על ידי PayPlus (חשבונית+) ונמצאת בחשבון PayPlus שלכם.";
    } else {
      receiptNote = "\nלא מחובר ספק חשבוניות, אז לא הונפקה קבלה.";
    }
  } catch (err) {
    if (!(err instanceof NoInvoiceProviderError)) captureError(err, { businessId, phase: "payment_request_receipt" });
    receiptNote = `\nהקבלה לא הונפקה: ${err instanceof Error ? err.message : String(err)}`;
  }

  await notifyOwner(businessId, `💰 ${who} שילם/ה ₪${fmtIls(request.amountIls)} עבור ${request.description}.${receiptNote}`);
  return true;
}
