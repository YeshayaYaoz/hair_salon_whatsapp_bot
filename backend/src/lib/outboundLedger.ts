import { prisma } from "./prisma.js";
import { notifyOwner } from "./ownerNotify.js";
import type { SendEvent } from "../webhook/whatsappClient.js";

/**
 * The record of every outbound WhatsApp message and what became of it. See the WhatsAppOutbound
 * model for why: a send returns 200 when Meta accepts, and the verdict — delivered, or failed
 * because the customer's window was closed or their number is dead — arrives later, on the status
 * webhook, and used to be thrown away for everything except campaigns.
 *
 * Two entry points. `recordOutbound` is wired into the client's send() as an observer, so every
 * send is written here without any call site having to remember. `recordOutboundStatuses` is
 * called from the status webhook and settles the row. Both are best-effort: a bookkeeping failure
 * must never cost a customer their message.
 */

export const OUTBOUND_STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 3 };

/**
 * Meta's delivery error codes, in the owner's terms. The code is what the webhook carries; the
 * sentence is what an owner can act on. Anything not listed falls back to the code itself.
 */
export const FAILURE_EXPLANATIONS: Record<number, string> = {
  131047: "הלקוח לא כתב לעסק ב-24 השעות האחרונות, ולכן הודעה חופשית לא נמסרת — רק תבנית מאושרת עוברת",
  131026: "המספר לא ניתן למסירה — לא בוואטסאפ, חסם את העסק, או מספר שגוי",
  131049: "מטא עצרה את ההודעה: הלקוח מקבל יותר מדי הודעות שיווקיות",
  131050: "הלקוח ביקש להפסיק לקבל הודעות שיווקיות מהעסק",
  131053: "המדיה (תמונה/קובץ) לא הצליחה להיטען אצל מטא",
  130472: "הלקוח לא מקבל הודעות שיווקיות (ניסוי של מטא)",
  132000: "מספר המשתנים בהודעה לא תואם לתבנית",
  132001: "התבנית לא קיימת בשפה הזאת",
  132015: "התבנית מושהית",
  132016: "התבנית נדחתה או הושבתה",
};

export function explainFailure(code: number | null | undefined, title?: string | null): string {
  if (code && FAILURE_EXPLANATIONS[code]) return FAILURE_EXPLANATIONS[code];
  if (code) return `שגיאה ${code}${title ? ` — ${title}` : ""}`;
  return title || "סיבה לא ידועה";
}

/**
 * Kinds where Tori spoke first. A dropped chat reply is a customer who will write again; a dropped
 * reminder is a no-show, a dropped confirmation is a customer who thinks they have no booking.
 * These are the ones whose failure the owner is told about.
 */
export const PROACTIVE_KINDS = new Set([
  "reminder", "review", "booking-confirmation", "payment-confirmation",
  "waitlist", "deposit-expired", "retention", "receipt", "campaign",
]);

/** Owner notices go to the owner, not a customer, and must not count as customer messages. */
export const OWNER_KIND = "owner-notice";

const CACHE_TTL_MS = 5 * 60 * 1000;
const businessByNumber = new Map<string, { id: string | null; at: number }>();

async function businessIdFor(phoneNumberId: string): Promise<string | null> {
  const hit = businessByNumber.get(phoneNumberId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.id;
  const row = await prisma.business.findUnique({ where: { whatsappPhoneNumberId: phoneNumberId }, select: { id: true } });
  const id = row?.id ?? null;
  businessByNumber.set(phoneNumberId, { id, at: Date.now() });
  return id;
}

/** For tests: the cache is process-wide and would otherwise leak between cases. */
export function __clearOutboundCache(): void {
  businessByNumber.clear();
}

/** Called for every send the client makes, accepted or refused. Never throws. */
export async function recordOutbound(e: SendEvent): Promise<void> {
  try {
    const businessId = await businessIdFor(e.phoneNumberId);
    await prisma.whatsAppOutbound.create({
      data: {
        messageId: e.messageId ?? null,
        businessId,
        phoneNumberId: e.phoneNumberId,
        to: e.to,
        kind: e.kind,
        templateName: e.templateName ?? null,
        ...(e.refused
          ? { status: "failed", failCode: e.refused.code ?? null, failTitle: e.refused.message.slice(0, 300), statusAt: new Date() }
          : {}),
      },
    });
  } catch (err) {
    console.error("[outbound ledger] Could not record send:", err);
  }
}

/**
 * Settles rows from the status webhook. Only ever moves a row forward — Meta delivers statuses out
 * of order, and "delivered" must not be overwritten by a late "sent". A failure on a proactive
 * message tells the owner, once, in terms they can act on.
 */
export async function recordOutboundStatuses(statuses: unknown[]): Promise<void> {
  for (const raw of statuses) {
    const status = raw as { id?: unknown; status?: unknown; errors?: Array<{ code?: unknown; title?: unknown }> };
    const messageId = typeof status?.id === "string" ? status.id : undefined;
    const next = typeof status?.status === "string" ? status.status : undefined;
    if (!messageId || !next || !(next in OUTBOUND_STATUS_RANK)) continue;

    try {
      const row = await prisma.whatsAppOutbound.findUnique({
        where: { messageId },
        select: { status: true, kind: true, businessId: true, to: true },
      });
      if (!row) continue; // a message this ledger never saw — nothing to settle
      if ((OUTBOUND_STATUS_RANK[row.status] ?? 0) >= OUTBOUND_STATUS_RANK[next] && row.status !== "sent") continue;

      const failCode = next === "failed" ? Number(status.errors?.[0]?.code) || null : null;
      const failTitle = next === "failed" ? String(status.errors?.[0]?.title ?? "").slice(0, 300) || null : null;
      await prisma.whatsAppOutbound.update({
        where: { messageId },
        data: { status: next, failCode, failTitle, statusAt: new Date() },
      });

      if (next === "failed" && row.businessId && PROACTIVE_KINDS.has(row.kind)) {
        const what = KIND_LABELS[row.kind] ?? row.kind;
        await notifyOwner(
          row.businessId,
          `⚠️ ${what} ללקוח ${row.to} לא נמסרה. ${explainFailure(failCode, failTitle)}. כדאי ליצור איתו קשר בדרך אחרת.`
        ).catch((err) => console.error("[outbound ledger] Owner notice about a failed message could not be sent:", err));
      }
    } catch (err) {
      console.error(`[outbound ledger] Could not settle status for ${messageId}:`, err);
    }
  }
}

const KIND_LABELS: Record<string, string> = {
  reminder: "התזכורת",
  review: "בקשת הביקורת",
  "booking-confirmation": "אישור התור",
  "payment-confirmation": "אישור התשלום",
  waitlist: "ההודעה על מקום שהתפנה",
  "deposit-expired": "ההודעה על פקיעת המקדמה",
  retention: "הודעת ההתעניינות",
  receipt: "הקבלה",
  campaign: "הודעת הקמפיין",
};

/** Customer messages that failed in the window — owner notices excluded. */
export async function countUndeliveredCustomerMessages(sinceMs: number, businessId?: string): Promise<number> {
  return prisma.whatsAppOutbound.count({
    where: {
      status: "failed",
      sentAt: { gte: new Date(Date.now() - sinceMs) },
      kind: { not: OWNER_KIND },
      ...(businessId ? { businessId } : {}),
    },
  });
}

/** Failure reasons in the window, most common first, already in the owner's terms. */
export async function undeliveredBreakdown(sinceMs: number): Promise<Array<{ count: number; reason: string }>> {
  const groups = await prisma.whatsAppOutbound.groupBy({
    by: ["failCode"],
    where: { status: "failed", sentAt: { gte: new Date(Date.now() - sinceMs) }, kind: { not: OWNER_KIND } },
    _count: { _all: true },
  });
  return groups
    .map((g) => ({ count: g._count._all, reason: explainFailure(g.failCode) }))
    .sort((a, b) => b.count - a.count);
}
