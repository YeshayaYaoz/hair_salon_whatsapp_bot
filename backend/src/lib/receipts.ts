import { prisma } from "./prisma.js";
import { decryptSecret } from "./crypto.js";
import { getInvoiceProvider, resolveInvoiceCredentials } from "./invoices/index.js";
import { sendWhatsAppMessage, RE_ENGAGEMENT_ERROR_CODE, WhatsAppSendError } from "../webhook/whatsappClient.js";
import { captureError } from "./errorMonitoring.js";

/**
 * Issuing a receipt and getting it into the customer's hands.
 *
 * These were separate concerns and should not have been. The payment webhook created receipts and
 * wrote the document URL to a server log — so a business that had connected an invoicing provider
 * got working receipts that no customer ever saw, and no screen ever showed. From the owner's side
 * the feature looked broken; from ours it looked like it worked.
 *
 * So issuing and delivering live together here, and both the automatic path (a paid deposit) and
 * the manual one (money taken at the counter) go through this. A receipt that exists but was not
 * delivered is reported as such rather than counted as success.
 */

export type DeliveryOutcome = "sent" | "window_closed" | "no_whatsapp" | "failed";

export interface IssuedReceipt {
  documentUrl: string;
  /** What happened when we tried to hand it to the customer. */
  delivery: DeliveryOutcome;
}

/** The business fields both issuing and delivering need. */
const BUSINESS_SELECT = {
  id: true,
  name: true,
  invoiceProvider: true,
  invoiceApiKey: true,
  invoiceApiSecret: true,
  paymentProvider: true,
  paymentApiKey: true,
  paymentApiSecret: true,
  paymentPageUid: true,
  whatsappPhoneNumberId: true,
  whatsappAccessToken: true,
} as const;

export class NoInvoiceProviderError extends Error {
  constructor() {
    super("This business has no invoicing provider connected.");
    this.name = "NoInvoiceProviderError";
  }
}

/**
 * Sends a receipt link to a customer on WhatsApp.
 *
 * Free-form text, so it only reaches customers inside the 24-hour service window. That is fine for
 * a receipt following a payment the customer just made, and often NOT fine for one an owner issues
 * days later — which is exactly why the outcome is returned instead of swallowed. The caller shows
 * the owner the link to forward themselves when the window is shut.
 */
export async function deliverReceipt(params: {
  business: { name: string; whatsappPhoneNumberId: string | null; whatsappAccessToken: string | null };
  customerPhone: string | undefined;
  documentUrl: string;
  amountIls: number;
  description: string;
}): Promise<DeliveryOutcome> {
  const { business, customerPhone, documentUrl, amountIls, description } = params;
  if (!customerPhone || !business.whatsappPhoneNumberId || !business.whatsappAccessToken) {
    return "no_whatsapp";
  }

  try {
    await sendWhatsAppMessage({
      phoneNumberId: business.whatsappPhoneNumberId,
      accessToken: decryptSecret(business.whatsappAccessToken),
      to: customerPhone,
      text: `קבלה על ${description} — ₪${amountIls}\nמ${business.name}\n\n${documentUrl}`,
    });
    return "sent";
  } catch (err) {
    // 131047 is not a failure of ours: the customer simply has not written in 24 hours, and Meta
    // blocks free-form messages to them. Distinguished from a real error so the owner is told to
    // forward the link rather than told something broke.
    if (err instanceof WhatsAppSendError && err.code === RE_ENGAGEMENT_ERROR_CODE) return "window_closed";
    console.error("[receipts] Could not deliver the receipt:", err);
    captureError(err, { phase: "receipt_delivery" });
    return "failed";
  }
}

/**
 * Issues a receipt through the business's own provider and sends it to the customer.
 *
 * Delivery failure never fails the call: the document is real, it exists in the provider's system
 * and counts for the business's books whatever happened on WhatsApp. The caller gets the URL and
 * the delivery outcome and decides what to say.
 */
export async function issueAndSendReceipt(params: {
  businessId: string;
  amountIls: number;
  description: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
}): Promise<IssuedReceipt> {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: params.businessId },
    select: BUSINESS_SELECT,
  });

  const resolved = resolveInvoiceCredentials(business);
  if (!resolved) throw new NoInvoiceProviderError();

  const provider = getInvoiceProvider(resolved.provider);
  const receipt = await provider.createReceipt(resolved.credentials, {
    amountIls: params.amountIls,
    description: params.description,
    customerName: params.customerName,
    customerPhone: params.customerPhone,
    customerEmail: params.customerEmail,
  });

  const delivery = await deliverReceipt({
    business,
    customerPhone: params.customerPhone,
    documentUrl: receipt.documentUrl,
    amountIls: params.amountIls,
    description: params.description,
  });

  return { documentUrl: receipt.documentUrl, delivery };
}

/** Hebrew for what the owner is told about delivery — the same wording wherever it is reported. */
export const DELIVERY_MESSAGE_HE: Record<DeliveryOutcome, string> = {
  sent: "הקבלה נשלחה ללקוח בוואטסאפ.",
  window_closed:
    "הקבלה הופקה, אבל וואטסאפ לא מאפשרת לשלוח ללקוח שלא כתב ב-24 השעות האחרונות. אפשר להעתיק את הקישור ולשלוח בעצמכם.",
  no_whatsapp: "הקבלה הופקה. אין ללקוח מספר וואטסאפ מחובר, אז אפשר לשלוח את הקישור בעצמכם.",
  failed: "הקבלה הופקה, אבל השליחה ללקוח נכשלה. אפשר להעתיק את הקישור ולשלוח בעצמכם.",
};
