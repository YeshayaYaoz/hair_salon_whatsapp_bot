import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getInvoiceProvider, resolveInvoiceCredentials } from "../lib/invoices/index.js";
import { captureError } from "../lib/errorMonitoring.js";

export const paymentWebhookRouter = Router();

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

// Configure this URL (…/webhook/payments/<provider>/<businessId>) as the notify/webhook/IPN URL
// in each provider's own merchant dashboard. businessId in the path is how we know which
// tenant's credentials to use, since these providers don't know about our multi-tenant setup.
paymentWebhookRouter.post("/:provider/:businessId", async (req, res) => {
  const { provider, businessId } = req.params;
  const parser = PARSERS[provider];
  if (!parser) return res.status(404).json({ error: "Unknown provider" });

  // Acknowledge fast — these providers retry aggressively on non-2xx, and receipt issuance
  // (below) is a slower external call we don't want to block the response on.
  res.status(200).json({ ok: true });

  try {
    const event = parser(req.body as Record<string, unknown>);
    if (!event.success) return;

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        paymentProvider: true,
        invoiceProvider: true,
        invoiceApiKey: true,
        invoiceApiSecret: true,
        paymentApiKey: true,
        paymentApiSecret: true,
      },
    });
    if (!business || business.paymentProvider !== provider) {
      console.warn(`[payments webhook] Unrecognized business/provider combo: ${businessId}/${provider}`);
      return;
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
