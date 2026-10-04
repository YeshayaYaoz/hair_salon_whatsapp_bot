import { decryptSecret } from "./crypto.js";

/**
 * Which WhatsApp number a business sends from.
 *
 * Its own, when it connected one. Otherwise Tori's: a business on the Receipts plan runs itself
 * from the owner's WhatsApp and never connects a number of its own — the receipts and alerts go
 * out from Tori's line with the business's name in the text ("קבלה מסטודיו רונית…"), the way a
 * payment app sends in a merchant's name. The same line also serves a trial that has not connected
 * yet, so its owner alerts arrive instead of waiting on a setup step.
 *
 * One function so every sender agrees. Before this, each sender read the business's own fields
 * and returned "not connected" when they were empty — correct for a bot business, and a dead end
 * for one that was never meant to connect.
 */
export interface SendingIdentity {
  phoneNumberId: string;
  /** Decrypted, ready for the API. */
  accessToken: string;
  /** True when sending from Tori's line rather than the business's own. */
  shared: boolean;
}

/** Tori's own line. The outreach number: it is on Tori's WABA, where every template is approved. */
export function sharedIdentity(): SendingIdentity | null {
  const phoneNumberId = process.env.TORI_OUTREACH_PHONE_NUMBER_ID?.trim();
  const accessToken = process.env.TORI_OUTREACH_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !accessToken) return null;
  return { phoneNumberId, accessToken, shared: true };
}

export function isSharedNumber(phoneNumberId: string): boolean {
  const configured = process.env.TORI_OUTREACH_PHONE_NUMBER_ID?.trim();
  return Boolean(configured) && phoneNumberId === configured;
}

export function sendingIdentity(business: {
  whatsappPhoneNumberId: string | null;
  whatsappAccessToken: string | null;
}): SendingIdentity | null {
  if (business.whatsappPhoneNumberId && business.whatsappAccessToken) {
    return { phoneNumberId: business.whatsappPhoneNumberId, accessToken: decryptSecret(business.whatsappAccessToken), shared: false };
  }
  return sharedIdentity();
}
