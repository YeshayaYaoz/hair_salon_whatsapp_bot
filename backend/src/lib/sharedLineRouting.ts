/**
 * Running a whole business from Tori's shared line — bot included.
 *
 * A business that has not connected a number of its own (a trial that signed up last night, or
 * one that never will) used to have a bot nobody could reach: its customers had no number to
 * write to until Meta's verification came through. On the shared line the receiving number says
 * nothing about the tenant, so the sender has to — and a customer is not an owner with a verified
 * number. What identifies them is what they write and what they wrote before:
 *
 *   1. A code. Every shared-line business has a short code (`sharedLineCode`), and its link
 *      pre-fills "… #ab3k7m" into the first message. The code wins over everything else, so a
 *      customer of two shared-line businesses can switch by following the other one's link.
 *   2. "דמו" — the public demo business (see demoLine.ts), when one is configured.
 *   3. Memory. A phone that was talking to a shared-line business recently is that business's
 *      customer still: "היי, אפשר שוב תור לשבוע הבא" three weeks later needs no code. Ninety days,
 *      wide enough for a monthly haircut cycle. The demo is the exception: it remembers only a
 *      live thread (the bot's own 48h idle window), so a prospect answering cold outreach days
 *      after trying the demo reaches the operator and not the demo salon.
 *
 * Opt-outs never arrive here: the webhook keeps them on their old paths (the receipt sender's
 * opt-out, or the lead finder's consent log), because a bot must never be what answers "הסר".
 */
import { prisma } from "./prisma.js";
import { getHistory } from "../bot/conversationStore.js";
import { planHasBot } from "./planFeatures.js";
import { demoBusinessId, isDemoTrigger } from "./demoLine.js";

const MEMORY_DAYS = 90;
/** Six characters from an alphabet without 0/o/1/l/i, since the code is read off a screen and typed. */
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 6;
const CODE_RE = /#([a-z0-9]{6})(?![a-z0-9])/i;

export function parseSharedCode(text: string): string | null {
  const m = text.match(CODE_RE);
  return m ? m[1].toLowerCase() : null;
}

export function generateSharedCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

/** The business's code, minted on first use. A collision on the unique column is retried; two in
 * a row at 31^6 codes would be a broken random source, and then the error is the right outcome. */
export async function ensureSharedLineCode(businessId: string): Promise<string> {
  const existing = await prisma.business.findUnique({ where: { id: businessId }, select: { sharedLineCode: true } });
  if (existing?.sharedLineCode) return existing.sharedLineCode;
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateSharedCode();
    try {
      await prisma.business.update({ where: { id: businessId }, data: { sharedLineCode: code } });
      return code;
    } catch (err) {
      if (attempt === 2) throw err;
    }
  }
  throw new Error("unreachable");
}

/** Tori's shared number as a person dials it (digits with country code), or null when the
 * deployment has none — in which case there is no link to hand out, and nothing else changes. */
export function sharedLineNumber(): string | null {
  const digits = (process.env.TORI_SHARED_WHATSAPP_NUMBER ?? "").replace(/\D/g, "");
  return digits || null;
}

/** The link a business puts on its Instagram, its Google profile, its door. Opens WhatsApp on
 * Tori's number with the business named and its code in the first message. */
export function sharedLineLink(code: string, businessName: string): string | null {
  const number = sharedLineNumber();
  if (!number) return null;
  const text = `היי, רוצה לקבוע תור אצל ${businessName} #${code}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export interface SharedStrangerRoute {
  business: Awaited<ReturnType<typeof prisma.business.findUnique>> & {};
  /** True when nothing has been said in this thread before — the reply that opens it. */
  opening: boolean;
}

/** A business a customer may reach on the shared line: no number of its own (one that has one is
 * reached on it), not blocked, and on a plan whose customers get a bot at all. */
function eligible(b: { whatsappPhoneNumberId: string | null; blockedAt: Date | null; subscriptionPlan: string | null } | null) {
  return Boolean(b && !b.whatsappPhoneNumberId && !b.blockedAt && planHasBot(b.subscriptionPlan));
}

export async function resolveSharedStranger(fromPhone: string, text: string): Promise<SharedStrangerRoute | null> {
  let business: Awaited<ReturnType<typeof prisma.business.findUnique>> = null;

  const code = parseSharedCode(text);
  if (code) {
    const byCode = await prisma.business.findUnique({ where: { sharedLineCode: code } });
    if (eligible(byCode)) business = byCode;
    else console.warn(`[sharedLine] code #${code} from ${fromPhone} matches no reachable business`);
  }

  const demoId = demoBusinessId();
  if (!business && demoId && isDemoTrigger(text)) {
    const demo = await prisma.business.findUnique({ where: { id: demoId } });
    if (eligible(demo)) business = demo;
    else console.warn(`[demo] TORI_DEMO_BUSINESS_ID ${demoId} is missing, blocked or has its own number — demo off`);
  }

  if (!business) {
    const since = new Date(Date.now() - MEMORY_DAYS * 24 * 60 * 60 * 1000);
    const recent = await prisma.conversationMessage.findMany({
      where: { phone: fromPhone, channel: "whatsapp", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { businessId: true },
    });
    for (const businessId of [...new Set(recent.map((r) => r.businessId))]) {
      const candidate = await prisma.business.findUnique({ where: { id: businessId } });
      if (!eligible(candidate)) continue;
      if (candidate!.id === demoId && (await getHistory(candidate!.id, fromPhone)).length === 0) continue;
      business = candidate;
      break;
    }
  }

  if (!business) return null;
  const opening = (await getHistory(business.id, fromPhone)).length === 0;
  return { business, opening };
}
