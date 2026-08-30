import { prisma } from "../lib/prisma.js";

/**
 * Deciding whether the person on the other end of a WhatsApp thread is the business owner.
 *
 * The whole security of the manager tools rests on one fact: the phone number is asserted by META,
 * not by the person typing. The webhook verifies Meta's X-Hub-Signature-256 HMAC over the raw body
 * before anything is parsed (see whatsappRoutes), and `message.from` lives inside that signed
 * envelope. A customer can type "my number is 0501234567" or "I'm the manager" all day; none of it
 * touches the value this module compares.
 *
 * So the rule is deliberately narrow and has exactly one input the sender does not control:
 *
 *     the number Meta says this message came from  ===  the number the owner saved, while
 *                                                       authenticated, in their own dashboard
 *
 * Both ends are authenticated — one by Meta's signature, the other by a dashboard login. Nothing in
 * the message body is consulted, and no tool may ever accept a phone number as an argument to
 * decide who is asking. That is the failure this module exists to make impossible.
 */

/** Digits only, so a number saved as "+972-50-123-4567" matches the "972501234567" Meta reports. */
function digits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export interface ManagerCheck {
  isManager: boolean;
  /** Present only for a manager — the business's own name, for phrasing replies. */
  businessName?: string;
}

/**
 * Whether this sender is the business's manager.
 *
 * `senderPhone` MUST be the value from the signed webhook envelope. Passing anything a user typed
 * would defeat the entire mechanism, which is why callers take it from `message.from` and nowhere
 * else.
 *
 * A business with no notification phone saved has no manager to recognise — that answers false
 * rather than falling back to something looser, because "no configured owner" must never widen
 * access.
 */
export async function checkManager(businessId: string, senderPhone: string): Promise<ManagerCheck> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true, notificationPhone: true },
  });
  if (!business?.notificationPhone) return { isManager: false };

  const sender = digits(senderPhone);
  const owner = digits(business.notificationPhone);
  // Both must be non-empty: two numbers that normalise to "" would otherwise compare equal and
  // make every sender a manager.
  if (!sender || !owner || sender !== owner) return { isManager: false };

  return { isManager: true, businessName: business.name };
}

/** Thrown when a manager-only tool is reached by anyone else. Never leaks that the tool exists. */
export class NotManagerError extends Error {
  constructor() {
    super("This action is only available to the business owner.");
    this.name = "NotManagerError";
  }
}
