/**
 * One definition of "the same phone number", shared by everything that has to compare or store one.
 *
 * This existed only inside voiceRoutes.ts, where it was written to fix a specific bug: Cartesia
 * dials in E.164 ("+972555077941") while an owner types their line the way they say it out loud
 * ("055-507-7941"), and stripping punctuation alone leaves two strings that are not equal. The same
 * mismatch applies anywhere a human-typed number meets a machine-formatted one, so it lives here.
 */

/**
 * Reduces a number to digits with a country code and no national trunk prefix.
 *
 * The leading-zero rule is the one every Israeli number follows: the 0 is dropped when the country
 * code goes on. Applied generally rather than only to +972, since it holds across the numbering
 * plans this would ever see, and Israel is the only market this runs in.
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) return `972${digits.slice(1)}`;
  return digits;
}

/**
 * Normalizes a number the owner typed, or returns null if it cannot plausibly be one.
 *
 * Deliberately a shape check rather than a lookup: we cannot know a number is real without sending
 * to it, and the send is what actually proves it (see notificationPhoneVerifiedAt). What this does
 * catch is the class of entry that is definitely wrong — a truncated number, a copy-pasted price, a
 * whole sentence — before it reaches Meta and comes back as an opaque failure hours later.
 *
 * Israeli numbers are 972 followed by 8-9 digits (mobile 972-5X-XXXXXXX, landline 972-X-XXXXXXX).
 * Non-Israeli numbers are accepted at a looser length, since an owner may legitimately use a
 * foreign number for alerts and rejecting it would be worse than accepting an odd one.
 */
export function normalizeOwnerPhone(raw: string): string | null {
  const digits = normalizePhone(raw.trim());
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith("972")) {
    const national = digits.slice(3);
    return national.length >= 8 && national.length <= 9 ? digits : null;
  }
  return digits.length >= 9 && digits.length <= 15 ? digits : null;
}
