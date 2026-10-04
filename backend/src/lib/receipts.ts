import { prisma } from "./prisma.js";
import { sendingIdentity } from "./sendingIdentity.js";
import { getInvoiceProvider, resolveInvoiceCredentials } from "./invoices/index.js";
import { sendWhatsAppMessage, sendWhatsAppTemplate, RE_ENGAGEMENT_ERROR_CODE, WhatsAppSendError } from "../webhook/whatsappClient.js";
import { captureError } from "./errorMonitoring.js";
import { receiptTemplate } from "./whatsappTemplates.js";
import { fmtIls } from "./money.js";

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

/** "sent" is a plain message inside the 24h window; "template" the approved template with a button
 * outside it. "window_closed" now only means the template is not approved on this WABA either. */
export type DeliveryOutcome = "sent" | "template" | "window_closed" | "no_whatsapp" | "failed";

export interface IssuedReceipt {
  /** The Receipt row — what the button link and the dashboard history refer to. */
  receiptId: string;
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
  customerName?: string | null;
  /** The Receipt row's id — the suffix on the template's button link. */
  receiptId: string;
  documentUrl: string;
  amountIls: number;
  description: string;
}): Promise<DeliveryOutcome> {
  const { business, customerPhone, documentUrl, amountIls, description } = params;
  // The business's own line, or Tori's for a business without one (see sendingIdentity).
  const identity = sendingIdentity(business);
  if (!customerPhone || !identity) {
    return "no_whatsapp";
  }
  const common = { phoneNumberId: identity.phoneNumberId, accessToken: identity.accessToken, to: customerPhone, kind: "receipt" as const };

  try {
    await sendWhatsAppMessage({ ...common, text: `קבלה על ${description} — ₪${fmtIls(amountIls)}\nמ${business.name}\n\n${documentUrl}` });
    return "sent";
  } catch (err) {
    // 131047: the customer has not written in 24 hours, so Meta blocks free-form text. That is the
    // normal case for a monthly receipt, not a failure — the approved template carries it instead.
    if (!(err instanceof WhatsAppSendError && err.code === RE_ENGAGEMENT_ERROR_CODE)) {
      console.error("[receipts] Could not deliver the receipt:", err);
      captureError(err, { phase: "receipt_delivery" });
      return "failed";
    }
  }

  const template = receiptTemplate();
  try {
    const first = params.customerName?.trim().split(/\s+/)[0] || "שלום";
    await sendWhatsAppTemplate({
      ...common,
      templateName: template.name,
      languageCode: template.languageCode,
      bodyParams: [first, business.name, description, fmtIls(amountIls)],
      urlSuffix: params.receiptId,
    });
    return "template";
  } catch (err) {
    // The template is not approved on this WABA (a business connected before it existed, or one
    // whose submission is still pending). The old outcome, with the old advice: forward the link.
    console.warn("[receipts] Receipt template send failed, window closed:", err instanceof Error ? err.message : err);
    return "window_closed";
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
  /** Links the Receipt row to the customer and, for a recurring charge, to its ChargeDue. */
  customerId?: string;
  chargeDueId?: string;
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

  // Recorded before delivery: the button link needs the id, and a document the provider issued
  // exists whatever WhatsApp does next.
  const row = await prisma.receipt.create({
    data: {
      businessId: params.businessId,
      customerId: params.customerId ?? null,
      chargeDueId: params.chargeDueId ?? null,
      amountIls: params.amountIls,
      description: params.description,
      documentUrl: receipt.documentUrl,
      delivery: "pending",
    },
  });

  const delivery = await deliverReceipt({
    business,
    customerPhone: params.customerPhone,
    customerName: params.customerName,
    receiptId: row.id,
    documentUrl: receipt.documentUrl,
    amountIls: params.amountIls,
    description: params.description,
  });
  await prisma.receipt.update({ where: { id: row.id }, data: { delivery } }).catch(() => {});

  return { receiptId: row.id, documentUrl: receipt.documentUrl, delivery };
}

/** Hebrew for what the owner is told about delivery — the same wording wherever it is reported. */
export const DELIVERY_MESSAGE_HE: Record<DeliveryOutcome, string> = {
  sent: "הקבלה נשלחה ללקוח בוואטסאפ.",
  template: "הקבלה נשלחה ללקוח בוואטסאפ, עם כפתור לפתיחה.",
  window_closed:
    "הקבלה הופקה, אבל וואטסאפ לא מאפשרת לשלוח ללקוח שלא כתב ב-24 השעות האחרונות. אפשר להעתיק את הקישור ולשלוח בעצמכם.",
  no_whatsapp: "הקבלה הופקה. אין ללקוח מספר וואטסאפ מחובר, אז אפשר לשלוח את הקישור בעצמכם.",
  failed: "הקבלה הופקה, אבל השליחה ללקוח נכשלה. אפשר להעתיק את הקישור ולשלוח בעצמכם.",
};
