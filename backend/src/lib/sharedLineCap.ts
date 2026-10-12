/**
 * How much a trial business may send from Tori's shared line.
 *
 * Every business without a number of its own answers its customers from the same line, so one
 * of them misbehaving — a trial that turns out to be a spammer, a bot stuck in a loop with a
 * hundred customers — costs the line its standing with Meta, and with it every other business on
 * it. A business that pays has a name and a card on file; a trial has an email address. This is
 * the bound on what an email address can do to the line: a fixed number of bot replies in a
 * rolling thirty days, after which the bot goes quiet for that business until it connects a number
 * of its own (where its replies are its own affair) or starts paying.
 *
 * Counted from the transcript rather than from the outbound ledger: on the shared line the ledger
 * resolves the business from the sending number, which is Tori's, so it cannot tell the businesses
 * apart. The bot's own replies in ConversationMessage can.
 *
 * Owner-side traffic is never counted or blocked — the owner writing to Tori to run the business
 * is the manager flow, not the customer bot — and neither is the public demo, which is the
 * operator's own.
 */
import { prisma } from "./prisma.js";
import { isDemoBusiness } from "./demoLine.js";

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Replies per rolling 30 days. Overridable per deployment; the default is generous for a real
 * salon trying the product (a booking takes four or five replies) and small for a spammer. */
export function sharedLineTrialCap(): number {
  const n = Number(process.env.SHARED_LINE_TRIAL_MESSAGE_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 150;
}

/** What a customer is told, once, when the business's bot has gone quiet. Kept as a constant so
 * the "told already" check can recognise it in the transcript. */
export const SHARED_LINE_CAP_NOTICE =
  "הבוט של העסק לא זמין כרגע בוואטסאפ. אפשר לנסות שוב מאוחר יותר, או לפנות לעסק ישירות.";

export interface SharedCapStatus {
  /** False when the cap does not apply to this business at all (own number, paying, or the demo). */
  applies: boolean;
  /** True when this reply must not be generated. */
  exceeded: boolean;
  /** True on the message that found the cap freshly reached, so the owner is told once. */
  justCrossed: boolean;
  used: number;
  cap: number;
}

export function sharedLineCapApplies(business: {
  id: string;
  subscriptionStatus: string;
  whatsappPhoneNumberId: string | null;
}): boolean {
  return !business.whatsappPhoneNumberId && business.subscriptionStatus === "trial" && !isDemoBusiness(business.id);
}

export async function countSharedLineReplies(businessId: string): Promise<number> {
  return prisma.conversationMessage.count({
    where: { businessId, role: "assistant", channel: "whatsapp", createdAt: { gte: new Date(Date.now() - WINDOW_MS) } },
  });
}

export async function checkSharedLineCap(business: {
  id: string;
  subscriptionStatus: string;
  whatsappPhoneNumberId: string | null;
}): Promise<SharedCapStatus> {
  const cap = sharedLineTrialCap();
  if (!sharedLineCapApplies(business)) return { applies: false, exceeded: false, justCrossed: false, used: 0, cap };
  const used = await countSharedLineReplies(business.id);
  // The notice to a customer is itself recorded as an assistant turn (see the webhook), so the
  // count moves past the cap on the first blocked message and this is true exactly once.
  return { applies: true, exceeded: used >= cap, justCrossed: used === cap, used, cap };
}

/** Whether this customer was already told, in the last day, that the bot is quiet. One notice per
 * customer per day: the notice itself goes out on the shared line, and sending it on every message
 * would be the very send loop the cap exists to stop. */
export async function capNoticeSentRecently(businessId: string, customerPhone: string): Promise<boolean> {
  const last = await prisma.conversationMessage.findFirst({
    where: { businessId, phone: customerPhone, role: "assistant", content: SHARED_LINE_CAP_NOTICE },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return Boolean(last && Date.now() - last.createdAt.getTime() < 24 * 60 * 60 * 1000);
}
