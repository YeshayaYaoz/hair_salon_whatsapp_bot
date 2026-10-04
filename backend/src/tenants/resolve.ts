import { prisma } from "../lib/prisma.js";
import { normalizePhone } from "../lib/phone.js";

/** Meta sends the receiving number's phone_number_id in every webhook payload; that's our tenant key. */
export async function resolveBusinessByPhoneNumberId(phoneNumberId: string) {
  return prisma.business.findUnique({ where: { whatsappPhoneNumberId: phoneNumberId } });
}

/**
 * On Tori's shared line the receiving number says nothing about the tenant — every business
 * without a number of its own is behind it. The sender does: an owner writes from the manager
 * number they registered and verified, and that number is the business.
 *
 * Verified, not merely typed: the number is the whole of the authorisation here (see managerAuth),
 * and a verified one has provably received a message from us. One manager per business is the
 * rule; if two businesses ever claim the same verified number, the most recently verified wins
 * rather than the request failing, and that is logged.
 */
export async function resolveBusinessBySender(senderPhone: string) {
  const phone = normalizePhone(senderPhone);
  const matches = await prisma.business.findMany({
    where: {
      whatsappPhoneNumberId: null,
      notificationPhone: { in: [phone, `+${phone}`] },
      notificationPhoneVerifiedAt: { not: null },
      blockedAt: null,
    },
    orderBy: { notificationPhoneVerifiedAt: "desc" },
    take: 2,
  });
  if (matches.length > 1) {
    console.warn(`[resolve] ${phone} is the verified manager number of ${matches.length} businesses; using ${matches[0].id}`);
  }
  return matches[0] ?? null;
}

/**
 * A customer writing to the shared line: which business were they last messaged on behalf of?
 * The latest receipt to their number answers it; nothing else on the shared line reaches customers.
 */
export async function resolveSharedCustomerBusiness(customerPhone: string) {
  const phone = normalizePhone(customerPhone);
  const receipt = await prisma.receipt.findFirst({
    where: { customer: { phone }, business: { whatsappPhoneNumberId: null } },
    orderBy: { createdAt: "desc" },
    select: { business: { select: { id: true, name: true } } },
  });
  return receipt?.business ?? null;
}
