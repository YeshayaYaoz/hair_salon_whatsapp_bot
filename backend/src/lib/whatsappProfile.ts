import { prisma } from "./prisma.js";
import { decryptSecret } from "./crypto.js";
import { setWhatsAppBusinessProfile } from "../webhook/whatsappClient.js";

/**
 * Keeps the WhatsApp business card in step with what the owner already told Tori.
 *
 * A salon fills in its address, website and category during setup, and until now none of it reached
 * WhatsApp: the profile a customer sees when they tap the business name stayed empty, and the only
 * way to fill it was to retype everything in Meta's console. The profile picture was the sole field
 * ever pushed, which made the gap easy to miss — the picture was there, so the card looked handled.
 *
 * Deliberately best-effort and never fatal. It runs on the connect path, where the owner is waiting
 * on a redirect, and after ordinary settings saves. A profile that is a few minutes stale is not
 * worth failing either of those over.
 */

/**
 * Meta's fixed category list. The API rejects anything outside it, and rejects the whole request
 * when it does — so an unmapped business type would silently take the address and website down with
 * it rather than just leaving the category blank.
 *
 * Tori's five types map onto three of Meta's: there is no "barber" or "aesthetics" vertical, and
 * "BEAUTY" is the closest honest fit for all three grooming trades. A B&B is "HOTEL".
 */
const VERTICAL_BY_BUSINESS_TYPE: Record<string, string> = {
  salon: "BEAUTY",
  barber: "BEAUTY",
  aesthetics: "BEAUTY",
  clinic: "HEALTH",
  bnb: "HOTEL",
};

/** Meta requires a scheme; an owner typing "zimmermeron.co.il" means https. */
function normalizeUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export async function syncWhatsAppProfile(businessId: string): Promise<void> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      name: true,
      email: true,
      address: true,
      businessType: true,
      greetingButtonUrl: true,
      whatsappPhoneNumberId: true,
      whatsappAccessToken: true,
      whatsappTokenValid: true,
    },
  });
  if (!business?.whatsappPhoneNumberId || !business.whatsappAccessToken) return;
  // A dead token turns this into a guaranteed 401 on every settings save. The owner is already
  // being told to reconnect by whatsappHealthJob; adding a second failure helps nobody.
  if (!business.whatsappTokenValid) return;

  // The greeting button is the one URL an owner is asked for anywhere in Tori, and it points at
  // their own site. Nothing else in the schema holds a website.
  const website = business.greetingButtonUrl ? normalizeUrl(business.greetingButtonUrl) : null;
  const vertical = business.businessType ? VERTICAL_BY_BUSINESS_TYPE[business.businessType] : undefined;

  await setWhatsAppBusinessProfile({
    phoneNumberId: business.whatsappPhoneNumberId,
    accessToken: decryptSecret(business.whatsappAccessToken),
    address: business.address ?? undefined,
    email: business.email,
    websites: website ? [website] : undefined,
    vertical,
    // The one-line "about" under the business name. Kept to the business's own name rather than
    // anything about Tori: this is the salon's storefront, not ours.
    description: business.name,
  });
}

/** Fire-and-forget wrapper — see the note above on why this must not fail its caller. */
export function syncWhatsAppProfileInBackground(businessId: string): void {
  syncWhatsAppProfile(businessId).catch((err) =>
    console.warn(`[whatsappProfile] Could not sync profile for ${businessId} (non-fatal):`, err)
  );
}
