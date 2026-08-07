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

/** Country code assumed when the owner picked none — every business on the platform is Israeli. */
export const DEFAULT_DIAL_CODE = "972";

/**
 * Normalizes a number the owner typed, or returns null if it cannot plausibly be one.
 *
 * Deliberately a shape check rather than a lookup: we cannot know a number is real without sending
 * to it, and the send is what actually proves it (see notificationPhoneVerifiedAt). What this does
 * catch is the class of entry that is definitely wrong — a truncated number, a copy-pasted price, a
 * whole sentence — before it reaches Meta and comes back as an opaque failure hours later.
 *
 * dialCode is the country the owner chose alongside the number, and it removes the guessing this
 * used to do. Two entries were wrong without it: a bare national number with no trunk zero
 * ("555077941") was stored with no country code at all and could never be delivered, and a foreign
 * number written in its own national form ("07700 900123") had 972 forced onto it because the rule
 * assumed every leading zero was Israeli.
 *
 * A number the owner wrote in full international form still wins over the dropdown — someone who
 * typed "+44…" means it, whatever the select happens to say.
 */
export function normalizeOwnerPhone(raw: string, dialCode: string = DEFAULT_DIAL_CODE): string | null {
  const trimmed = raw.trim();
  const code = dialCode.replace(/\D/g, "") || DEFAULT_DIAL_CODE;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  const qualified = trimmed.startsWith("+")
    ? digits // written in full international form
    : digits.startsWith("0")
      ? `${code}${digits.slice(1)}` // national trunk prefix, replaced by the country code
      // A number that already opens with the chosen code was typed international without the "+".
      // Checked before prepending, or "972555077941" would become "972972555077941".
      : digits.startsWith(code)
        ? digits
        : `${code}${digits}`;

  if (qualified.startsWith("972")) {
    // Israel: 8-9 digits after the code (mobile 972-5X-XXXXXXX, landline 972-X-XXXXXXX).
    const national = qualified.slice(3);
    return national.length >= 8 && national.length <= 9 ? qualified : null;
  }
  // Looser elsewhere: an owner may legitimately use a foreign number, and rejecting a real one is
  // worse than accepting an odd one — the send is what proves it either way.
  return qualified.length >= 9 && qualified.length <= 15 ? qualified : null;
}
