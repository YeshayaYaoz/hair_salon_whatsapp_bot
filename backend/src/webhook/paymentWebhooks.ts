import { asyncRouter } from "../lib/asyncRouter.js";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { getInvoiceProvider, resolveInvoiceCredentials } from "../lib/invoices/index.js";
import { captureError } from "../lib/errorMonitoring.js";
import { decryptSecret } from "../lib/crypto.js";
import { sendWhatsAppMessage } from "./whatsappClient.js";
import { syncAppointmentToCalendar } from "../lib/googleCalendar.js";
import { notifyOwner } from "../lib/ownerNotify.js";

export const paymentWebhookRouter = asyncRouter();

interface ParsedPaymentEvent {
  success: boolean;
  amountIls?: number;
  referenceId?: string;
  customerName?: string;
  customerPhone?: string;
}

// Each provider's webhook payload shape is different — normalize to one common event before
// deciding whether to auto-issue a receipt. Field names below reflect each provider's own
// terminology (PayPlus: more_info/status_code, Tranzila: myid/Response, Cardcom: ReturnValue/ResponseCode).
function parsePayPlusEvent(body: Record<string, unknown>): ParsedPaymentEvent {
  const data = (body.data ?? body) as Record<string, unknown>;
  const status = (data.status_code ?? data.status) as string | number | undefined;
  return {
    success: status === "000" || status === 0 || status === "success",
    amountIls: typeof data.amount === "number" ? data.amount : Number(data.amount) || undefined,
    referenceId: (data.more_info as string) || undefined,
    customerName: (data.customer_name as string) || undefined,
    customerPhone: (data.customer_phone as string) || undefined,
  };
}

function parseTranzilaEvent(body: Record<string, unknown>): ParsedPaymentEvent {
  return {
    success: body.Response === "000",
    amountIls: Number(body.sum) || undefined,
    referenceId: (body.myid as string) || undefined,
    customerName: (body.contact as string) || undefined,
    customerPhone: (body.phone as string) || undefined,
  };
}

function parseCardcomEvent(body: Record<string, unknown>): ParsedPaymentEvent {
  const responseCode = Number(body.ResponseCode ?? body.ResponseCodeString);
  return {
    success: responseCode === 0,
    amountIls: Number(body.Amount) || undefined,
    referenceId: (body.ReturnValue as string) || undefined,
    customerName: (body.CardOwnerName as string) || undefined,
  };
}

function parseGrowEvent(body: Record<string, unknown>): ParsedPaymentEvent {
  const data = (body.data ?? body) as Record<string, unknown>;
  const fields = (data.pageField ?? {}) as Record<string, unknown>;
  return {
    success: Number(body.status) === 1,
    amountIls: Number(data.sum) || undefined,
    referenceId: (fields.cField1 as string) || undefined,
    customerName: (data.fullName as string) || undefined,
    customerPhone: (data.phone as string) || undefined,
  };
}

const PARSERS: Record<string, (body: Record<string, unknown>) => ParsedPaymentEvent> = {
  payplus: parsePayPlusEvent,
  tranzila: parseTranzilaEvent,
  cardcom: parseCardcomEvent,
  grow: parseGrowEvent,
};

// Configure this URL (…/webhook/payments/<provider>/<businessId>/<webhookSecret>) as the notify/
// webhook/IPN URL in each provider's own merchant dashboard. businessId in the path is how we know
// which tenant's credentials to use, since these providers don't know about our multi-tenant
// setup. webhookSecret is what actually authenticates the request: it's a random value generated
// when the business first connects a payment provider (businessRoutes.ts), shown to them once to
// paste into their provider's dashboard, and NEVER exposed anywhere a customer could see it —
// unlike businessId/the appointment id, which do leak via the customer-facing payment link. We
// deliberately don't implement per-provider HMAC/signature verification here: each provider's
// actual signing scheme isn't confirmed against live docs/sandbox for this integration, and
// shipping a guessed implementation would be worse than this — either silently accepting forged
// requests if wrong, or silently dropping real ones. This secret is the verifiable alternative.
paymentWebhookRouter.post("/:provider/:businessId/:webhookSecret", async (req, res) => {
  const { provider, businessId, webhookSecret } = req.params;
  const parser = PARSERS[provider];
  if (!parser) return res.status(404).json({ error: "Unknown provider" });

  // Acknowledge fast — these providers retry aggressively on non-2xx, and receipt issuance
  // (below) is a slower external call we don't want to block the response on.
  res.status(200).json({ ok: true });

  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        name: true,
        timezone: true,
        paymentProvider: true,
        paymentWebhookSecret: true,
        invoiceProvider: true,
        invoiceApiKey: true,
        invoiceApiSecret: true,
        paymentApiKey: true,
        paymentApiSecret: true,
        whatsappPhoneNumberId: true,
        whatsappAccessToken: true,
      },
    });
    if (!business || business.paymentProvider !== provider) {
      console.warn(`[payments webhook] Unrecognized business/provider combo: ${businessId}/${provider}`);
      return;
    }
    if (
      !business.paymentWebhookSecret ||
      webhookSecret.length !== business.paymentWebhookSecret.length ||
      !crypto.timingSafeEqual(Buffer.from(webhookSecret), Buffer.from(business.paymentWebhookSecret))
    ) {
      console.warn(`[payments webhook] Invalid webhook secret for business ${businessId} (${provider})`);
      return;
    }

    const event = parser(req.body as Record<string, unknown>);
    if (!event.success) return;

    // Deposit-before-booking: the payment link's referenceId is the appointment's own id (see
    // claudeBot.ts book_appointment). If this event matches a still-pending hold, confirm it —
    // this is what actually turns a "pending_payment" hold into a real booking, across every
    // provider, since each already has its own event parser above keyed by referenceId.
    if (event.referenceId) {
      const pending = await prisma.appointment.findFirst({
        where: { id: event.referenceId, businessId, status: "pending_payment", depositStatus: "pending" },
        include: { service: true, customer: true },
      });
      // Defense in depth: these webhooks aren't signature-verified (each provider's IPN payload
      // shape differs and none are wired to real sandbox creds yet), so a forged POST to this URL
      // is otherwise enough to "confirm" a booking for free. Requiring the reported amount to at
      // least cover the deposit blocks the trivial case of a bare/zero-amount forged payload.
      if (pending && (!event.amountIls || event.amountIls < (pending.depositAmountIls ?? 0))) {
        console.warn(
          `[payments webhook] Rejecting deposit confirmation for ${pending.id}: reported amount ${event.amountIls} below required ${pending.depositAmountIls}`
        );
        return;
      }
      if (pending) {
        await prisma.appointment.update({
          where: { id: pending.id },
          data: { status: "confirmed", depositStatus: "paid", depositPaidAt: new Date() },
        });
        console.log(`[payments webhook] Deposit paid — confirmed appointment ${pending.id} (${provider}/${businessId})`);

        syncAppointmentToCalendar(businessId, {
          startTime: pending.startTime,
          endTime: pending.endTime,
          serviceName: pending.service.name,
          customerName: pending.customer.name ?? undefined,
          customerPhone: pending.customer.phone,
        })
          .then((eventId) => {
            if (eventId) return prisma.appointment.update({ where: { id: pending.id }, data: { calendarEventId: eventId } });
          })
          .catch((err) => console.error("Calendar sync failed:", err));

        const tz = business.timezone || "Asia/Jerusalem";
        const when = pending.startTime.toLocaleString("he-IL", {
          timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
        });

        if (business.whatsappPhoneNumberId && business.whatsappAccessToken) {
          const accessToken = decryptSecret(business.whatsappAccessToken);
          sendWhatsAppMessage({
            phoneNumberId: business.whatsappPhoneNumberId,
            accessToken,
            to: pending.customer.phone,
            text: `✅ המקדמה התקבלה! התור שלך ל${pending.service.name} ב-${when} אצל ${business.name} מאושר סופית. מחכים לך!`,
          }).catch((err) => console.error("[payments webhook] Deposit confirmation message failed:", err));
        }

        // This is where a deposit booking becomes real, so this is where the owner has to hear
        // about it. Without this, switching deposits on silently switched new-booking alerts off:
        // the non-deposit path announces the booking at creation time (claudeBot.ts), but a deposit
        // booking is only a hold at that point and deliberately stays quiet until the money lands —
        // and nothing was announcing it when it did.
        const customerLabel = pending.customer.name
          ? `${pending.customer.name} (${pending.customer.phone})`
          : pending.customer.phone;
        notifyOwner(
          businessId,
          `💰 מקדמה שולמה — התור מאושר!\nלקוח: ${customerLabel}\nשירות: ${pending.service.name}\nמועד: ${when}\nסכום: ₪${pending.depositAmountIls ?? event.amountIls ?? "?"}`
        );
      }
    }

    const resolved = resolveInvoiceCredentials(business);
    if (!resolved) return; // no invoice provider connected — payment still succeeded, just no auto-receipt

    if (!event.amountIls || !event.customerName) {
      console.warn(`[payments webhook] Missing amount/customer name for ${provider}/${businessId} — skipping receipt`);
      return;
    }

    const invoiceProvider = getInvoiceProvider(resolved.provider);
    const receipt = await invoiceProvider.createReceipt(resolved.credentials, {
      amountIls: event.amountIls,
      description: "תשלום עבור טיפול",
      customerName: event.customerName,
      customerPhone: event.customerPhone,
    });
    console.log(`[payments webhook] Auto-issued receipt for ${businessId}: ${receipt.documentUrl}`);
  } catch (err) {
    console.error(`[payments webhook] Failed to process ${provider} event for business ${businessId}:`, err);
    captureError(err, { businessId, provider, phase: "payment webhook" });
  }
});
