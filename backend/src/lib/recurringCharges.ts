import { prisma } from "./prisma.js";
import { notifyOwner } from "./ownerNotify.js";
import { issueAndSendReceipt, NoInvoiceProviderError, DELIVERY_MESSAGE_HE, type IssuedReceipt } from "./receipts.js";
import { captureError } from "./errorMonitoring.js";
import { fmtIls } from "./money.js";
import { todayIn, dayBounds } from "../bot/managerActions.js";

/**
 * Monthly charges a business's customers pay it, and the receipts that follow.
 *
 * The shape of the product: a studio with eighty members, each paying a fixed sum on a fixed day,
 * wants every one of them to get a receipt on WhatsApp — and nothing else from Tori. Tori does not
 * take the money. The owner tells Tori it arrived, from the dashboard or on WhatsApp, and the
 * receipt is issued and sent that moment.
 *
 * Why the confirmation is not optional: a receipt is a document stating money was received. Issuing
 * one every 1st of the month because a row says so would put false documents in the business's
 * books whenever a member missed a payment. The nightly job therefore creates a "due" and tells the
 * owner; the receipt waits for them.
 */

export interface DueRow {
  id: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string;
  amountIls: number;
  description: string;
  dueDate: Date;
}

/** Day-of-month clamped to what the month has: a charge on the 31st falls on April 30th. */
function effectiveDay(dayOfMonth: number, year: number, month1: number): number {
  const daysInMonth = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  return Math.min(dayOfMonth, daysInMonth);
}

/**
 * Hourly. For every active recurring charge whose day is today in the business's timezone, creates
 * this month's due (once — the unique index on charge + dueDate makes a second run a no-op), then
 * tells the owner, once, how many are waiting.
 */
export async function runRecurringChargesJob(): Promise<void> {
  const businesses = await prisma.business.findMany({
    where: { recurringCharges: { some: { active: true } }, subscriptionStatus: { in: ["trial", "active"] } },
    select: { id: true, timezone: true, recurringCharges: { where: { active: true }, select: { id: true, customerId: true, amountIls: true, description: true, dayOfMonth: true } } },
  });

  for (const business of businesses) {
    const today = todayIn(business.timezone);
    const [y, m, d] = today.split("-").map(Number);
    const dueToday = business.recurringCharges.filter((c) => effectiveDay(c.dayOfMonth, y, m) === d);
    if (dueToday.length === 0) continue;

    const { start: dueDate } = dayBounds(today, business.timezone);
    let created = 0;
    let totalIls = 0;
    for (const charge of dueToday) {
      try {
        await prisma.chargeDue.create({
          data: {
            businessId: business.id,
            recurringChargeId: charge.id,
            customerId: charge.customerId,
            amountIls: charge.amountIls,
            description: charge.description,
            dueDate,
          },
        });
        created++;
        totalIls += charge.amountIls;
      } catch (err) {
        // Unique violation: this month's due already exists. The expected outcome on every run
        // after the first each day.
        if (!(err instanceof Error && /Unique constraint/i.test(err.message))) {
          captureError(err, { businessId: business.id, phase: "recurring_charge_due" });
        }
      }
    }
    if (created === 0) continue;

    const pending = await prisma.chargeDue.count({ where: { businessId: business.id, status: "pending" } });
    await notifyOwner(
      business.id,
      `היום ${created} ${created === 1 ? "חיוב קבוע" : "חיובים קבועים"} בסך ₪${fmtIls(totalIls)}${pending > created ? ` (ובסך הכל ${pending} ממתינים לאישור)` : ""}.\n` +
        `כשהכסף נכנס, כתבו לי למשל "התקבל מדנה" או "אשרי את כל החיובים", ואני אפיק קבלה ואשלח ללקוח. אפשר גם מהדשבורד, בעמוד קבלות.`
    );
  }
}

export async function listPendingDues(businessId: string): Promise<DueRow[]> {
  const rows = await prisma.chargeDue.findMany({
    where: { businessId, status: "pending" },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    include: { customer: { select: { name: true, phone: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    customerId: r.customerId,
    customerName: r.customer.name,
    customerPhone: r.customer.phone,
    amountIls: r.amountIls,
    description: r.description,
    dueDate: r.dueDate,
  }));
}

export type ConfirmOutcome =
  | { ok: true; receipt: IssuedReceipt; message: string }
  | { ok: false; error: string; code: "not_found" | "already" | "no_provider" | "provider_failed" };

/**
 * The owner says the money came in: issue the receipt and send it. The due is marked received only
 * after the provider issued the document, so a provider outage leaves it pending to retry, never
 * "received" with nothing behind it.
 */
export async function confirmChargeDue(businessId: string, dueId: string): Promise<ConfirmOutcome> {
  const due = await prisma.chargeDue.findFirst({
    where: { id: dueId, businessId },
    include: { customer: { select: { id: true, name: true, phone: true } } },
  });
  if (!due) return { ok: false, error: "החיוב לא נמצא.", code: "not_found" };
  if (due.status !== "pending") return { ok: false, error: "החיוב הזה כבר טופל.", code: "already" };

  try {
    const receipt = await issueAndSendReceipt({
      businessId,
      amountIls: due.amountIls,
      description: due.description,
      customerName: due.customer.name?.trim() || "לקוח",
      customerPhone: due.customer.phone,
      customerId: due.customer.id,
      chargeDueId: due.id,
    });
    await prisma.chargeDue.update({ where: { id: due.id }, data: { status: "received", resolvedAt: new Date() } });
    return { ok: true, receipt, message: DELIVERY_MESSAGE_HE[receipt.delivery] };
  } catch (err) {
    if (err instanceof NoInvoiceProviderError) {
      return { ok: false, error: "לא מחובר ספק חשבוניות. חברו אחד בעמוד סליקה וחשבוניות, ואז אשרו שוב.", code: "no_provider" };
    }
    console.error("[recurring] Receipt failed:", err);
    captureError(err, { businessId, phase: "recurring_receipt" });
    return { ok: false, error: "הפקת הקבלה נכשלה מול ספק החשבוניות. החיוב נשאר ממתין, נסו שוב מאוחר יותר.", code: "provider_failed" };
  }
}

/** No money this month: close the due without a receipt. Next month's is created as usual. */
export async function skipChargeDue(businessId: string, dueId: string): Promise<boolean> {
  const r = await prisma.chargeDue.updateMany({
    where: { id: dueId, businessId, status: "pending" },
    data: { status: "skipped", resolvedAt: new Date() },
  });
  return r.count > 0;
}
