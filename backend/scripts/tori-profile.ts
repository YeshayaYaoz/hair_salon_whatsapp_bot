/**
 * Fills in the WhatsApp business profile on Tori's own number: the card people see when they tap
 * the business name, plus the profile picture.
 *
 * Usage (from backend/, against the environment holding the credentials):
 *   railway run npx tsx scripts/tori-profile.ts            # show what is there now and what would change
 *   railway run npx tsx scripts/tori-profile.ts --confirm  # write it
 *
 * The display NAME is not set here. That is `verified_name`, it changes only through a review
 * Meta runs by hand (scripts/meta-add-number.ts --rename), and it is currently pending. Everything
 * in this file is the profile around that name, which needs no review and takes effect at once.
 *
 * The picture is flattened onto white before upload. The source logo is a transparent PNG, and
 * WhatsApp renders transparency as black — so the untouched file would show a black square on
 * every customer's screen.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { setWhatsAppBusinessProfile, setWhatsAppProfilePicture } from "../src/webhook/whatsappClient.js";

const GRAPH = "https://graph.facebook.com/v23.0";

const phoneNumberId = process.env.TORI_OUTREACH_PHONE_NUMBER_ID?.trim();
const accessToken = (process.env.TORI_OUTREACH_ACCESS_TOKEN ?? process.env.META_SYSTEM_USER_TOKEN)?.trim();
const appId = process.env.META_APP_ID?.trim();
const confirm = process.argv.includes("--confirm");

/**
 * `about` is the one-line status under the name — WhatsApp allows 139 characters and truncates
 * silently past that. `description` is the longer paragraph on the business card, 512.
 *
 * Both say the same thing at different lengths on purpose: someone who only ever sees the short
 * one should still know what this number is, because an unexplained business number messaging you
 * is the thing people block.
 */
const ABOUT = "עוזר חכם לזימון תורים — עונה ללקוחות בוואטסאפ ובטלפון, קובע תורים ומסנכרן ליומן.";

const DESCRIPTION =
  "תורי אונליין נותנת לעסקים קטנים בישראל עוזר חכם שעונה ללקוחות בוואטסאפ ובטלפון בכל שעה, " +
  "קובע ומזיז תורים, שולח תזכורות ומסנכרן הכל ליומן — כדי שאף פנייה לא תישאר בלי מענה. " +
  "מהמספר הזה נשלחות הודעות שירות ללקוחות תורי.";

const WEBSITE = "https://torionline.com";

// Meta's fixed list; anything outside it is rejected for the whole request, which would take the
// website and description down with it. Tori sells a service to businesses.
const VERTICAL = "PROF_SERVICES";

const LOGO = path.resolve(import.meta.dirname, "../../admin/public/tori_logo_transparent.png");

async function currentProfile() {
  const res = await fetch(
    `${GRAPH}/${phoneNumberId}/whatsapp_business_profile?fields=about,description,address,email,websites,vertical,profile_picture_url&access_token=${accessToken}`
  );
  const body = (await res.json()) as { data?: Record<string, unknown>[]; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message);
  return body.data?.[0] ?? {};
}

async function main() {
  if (!phoneNumberId || !accessToken) {
    console.error("TORI_OUTREACH_PHONE_NUMBER_ID and an access token must both be set.");
    process.exit(1);
  }

  const before = await currentProfile();
  console.log("Currently on the profile:");
  for (const key of ["about", "description", "websites", "vertical", "address", "email"]) {
    console.log(`  ${key.padEnd(14)} ${JSON.stringify((before as Record<string, unknown>)[key] ?? null)}`);
  }
  console.log(`  picture        ${before.profile_picture_url ? "set" : "none"}`);
  console.log("");

  console.log("Would set:");
  console.log(`  about (${ABOUT.length}/139)   ${ABOUT}`);
  console.log(`  description (${DESCRIPTION.length}/512)`);
  console.log(`    ${DESCRIPTION}`);
  console.log(`  websites       ${WEBSITE}`);
  console.log(`  vertical       ${VERTICAL}`);
  console.log(`  picture        ${LOGO} → 640×640 JPEG on white`);
  console.log("");

  if (!confirm) {
    console.log("Nothing written. Re-run with --confirm.");
    return;
  }

  await setWhatsAppBusinessProfile({
    phoneNumberId,
    accessToken,
    about: ABOUT,
    description: DESCRIPTION,
    websites: [WEBSITE],
    vertical: VERTICAL,
  });
  console.log("✔ Business card updated.");

  if (!appId) {
    // The upload session is opened against the app, so there is no picture without it. Reported
    // rather than thrown: the card above is already saved and that half should not be undone by it.
    console.log("⚠ META_APP_ID is not set — the picture needs it for the upload session. Card saved, picture skipped.");
    return;
  }

  // Flattened onto white, square, and well under Meta's 5MB limit. `flatten` is what stops the
  // transparent background rendering as black in WhatsApp.
  const imageBuffer = await sharp(await readFile(LOGO))
    .flatten({ background: "#FFFFFF" })
    .resize(640, 640, { fit: "contain", background: "#FFFFFF" })
    .jpeg({ quality: 90 })
    .toBuffer();

  await setWhatsAppProfilePicture({
    phoneNumberId,
    accessToken,
    appId,
    imageBuffer,
    mimeType: "image/jpeg",
  });
  console.log(`✔ Profile picture set (${Math.round(imageBuffer.length / 1024)} KB).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
