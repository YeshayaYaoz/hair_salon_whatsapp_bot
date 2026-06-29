import { prisma } from "../lib/prisma.js";

/** Meta sends the receiving number's phone_number_id in every webhook payload; that's our tenant key. */
export async function resolveBusinessByPhoneNumberId(phoneNumberId: string) {
  return prisma.business.findUnique({ where: { whatsappPhoneNumberId: phoneNumberId } });
}
