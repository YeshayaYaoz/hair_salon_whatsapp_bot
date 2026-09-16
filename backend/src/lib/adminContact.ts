import { prisma } from "./prisma.js";
import { normalizeOwnerPhone } from "./phone.js";

/**
 * A super-admin edit of a business's contact details: the owner's notification phone and the
 * account email.
 *
 * Kept out of the route so the rules are testable on their own, and because both fields carry
 * consequences beyond the row they live in. The phone is the number every owner alert goes to
 * and, more importantly, the number the manager tools trust — whoever holds it can run the
 * business from WhatsApp, which is exactly why an operator sometimes has to change it (an owner
 * who lost a phone) and why the change is audited. The email is the login identity.
 *
 * Phone rules match PUT /me exactly: normalised to a fully qualified number, empty clears it, and a
 * different number is an unproven number — notificationPhoneVerifiedAt is reset so the next
 * successful send re-proves it, the same self-healing the owner's own edit gets.
 *
 * emailVerifiedAt is deliberately left alone. Login refuses an unverified email, so resetting it
 * here would lock a paying business out of its dashboard over a support edit, with the
 * verification mail going to an address the operator just typed. An operator setting the address
 * deliberately, with their name in the audit log, is stronger vouching than a click on a link.
 */
export type ContactChangeResult =
  | { ok: true; notificationPhone: string | null; email: string; changed: string[] }
  | { ok: false; status: 400 | 404 | 409; error: string };

export async function updateBusinessContact(
  businessId: string,
  input: { notificationPhone?: string; email?: string }
): Promise<ContactChangeResult> {
  const current = await prisma.business.findUnique({
    where: { id: businessId },
    select: { notificationPhone: true, email: true },
  });
  if (!current) return { ok: false, status: 404, error: "Business not found" };

  const data: { notificationPhone?: string | null; notificationPhoneVerifiedAt?: null; email?: string } = {};
  const changed: string[] = [];

  if (input.notificationPhone !== undefined) {
    const raw = input.notificationPhone.trim();
    if (raw === "") {
      if (current.notificationPhone !== null) {
        data.notificationPhone = null;
        data.notificationPhoneVerifiedAt = null;
        changed.push("notificationPhone");
      }
    } else {
      const normalized = normalizeOwnerPhone(raw);
      if (!normalized) {
        return { ok: false, status: 400, error: "מספר הטלפון לא נראה תקין. הזינו מספר מלא, למשל 0501234567." };
      }
      if (normalized !== current.notificationPhone) {
        data.notificationPhone = normalized;
        data.notificationPhoneVerifiedAt = null;
        changed.push("notificationPhone");
      }
    }
  }

  if (input.email !== undefined) {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, status: 400, error: "כתובת האימייל לא נראית תקינה." };
    }
    if (email !== current.email) {
      // The login identity is unique across every business. Checked here rather than left to the
      // constraint so the operator gets a sentence, not a Prisma error code.
      const taken = await prisma.business.findUnique({ where: { email }, select: { id: true } });
      if (taken && taken.id !== businessId) {
        return { ok: false, status: 409, error: "כתובת האימייל הזו כבר בשימוש אצל עסק אחר." };
      }
      data.email = email;
      changed.push("email");
    }
  }

  if (changed.length === 0) {
    return { ok: true, notificationPhone: current.notificationPhone, email: current.email, changed };
  }

  const updated = await prisma.business.update({
    where: { id: businessId },
    data,
    select: { notificationPhone: true, email: true },
  });
  return { ok: true, notificationPhone: updated.notificationPhone, email: updated.email, changed };
}
