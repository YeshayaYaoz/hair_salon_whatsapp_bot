/**
 * Prints, per business, which WhatsApp line Tori actually sends through.
 *
 * Usage (from backend/):
 *   railway run npx tsx scripts/whatsapp-wiring.ts
 *
 * Two different questions get confused here, and both confusions have already caused a working
 * business to be called broken:
 *
 *   - A WABA listing covers ONE account. A number sitting in it PENDING/NOT_VERIFIED looks
 *     abandoned, while the same number is live on a different WABA entirely.
 *   - Our own columns record what OUR code did. whatsappRegisteredAt is null for every business
 *     that connected through Embedded Signup or was set up by hand, and those are working.
 *
 * So this prints both sides: what we have stored, and — using each business's own token — what Meta
 * says about that exact line. Meta's answer is the one that decides whether messages flow.
 *
 * Read-only. Tokens are decrypted only to authenticate the check, and never printed.
 */

import { PrismaClient } from "@prisma/client";
import { decryptSecret } from "../src/lib/crypto.js";

const prisma = new PrismaClient();

const GRAPH = "https://graph.facebook.com/v23.0";

/**
 * What Meta says about the line, which is the only thing that decides whether messages flow.
 *
 * Our own whatsappRegisteredAt records that *our* registration call ran. A business that came
 * through Embedded Signup, or was registered by hand in WhatsApp Manager, is live with that column
 * still null — so reading it as connectivity reports working businesses as broken. It happened
 * twice in one session.
 */
async function askMeta(phoneNumberId: string, token: string): Promise<string> {
  try {
    const res = await fetch(
      `${GRAPH}/${phoneNumberId}?fields=display_phone_number,verified_name,status,code_verification_status,platform_type,quality_rating`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const error = json.error as { message?: string } | undefined;
    if (error) return `Meta: ERROR — ${error.message}`;
    return [
      `Meta: ${json.display_phone_number} "${json.verified_name}"`,
      `        line ${json.status} / verification ${json.code_verification_status}`,
      `        platform ${json.platform_type ?? "?"} / quality ${json.quality_rating ?? "?"}`,
    ].join("\n");
  } catch (err) {
    return `Meta: unreachable — ${(err as Error).message}`;
  }
}

async function main() {
  const businesses = await prisma.business.findMany({
    select: {
      id: true,
      name: true,
      whatsappPhoneNumberId: true,
      whatsappWabaId: true,
      whatsappAccessToken: true,
      whatsappTokenValid: true,
      whatsappRegisteredAt: true,
      voicePhoneNumber: true,
    },
    orderBy: { name: "asc" },
  });

  console.log(`${businesses.length} business(es):\n`);
  for (const b of businesses) {
    console.log(`${b.name}  (id ${b.id})`);
    console.log(`    whatsapp phone number id: ${b.whatsappPhoneNumberId ?? "— none —"}`);
    console.log(`    whatsapp WABA id:         ${b.whatsappWabaId ?? "— none —"}`);
    console.log(`    access token:             ${b.whatsappAccessToken ? "set" : "— none —"}${b.whatsappTokenValid ? "" : " (marked INVALID)"}`);
    console.log(`    our registration call ran:  ${b.whatsappRegisteredAt?.toISOString() ?? "never (does NOT mean disconnected)"}`);
    console.log(`    voice number:             ${b.voicePhoneNumber ?? "— none —"}`);
    if (b.whatsappPhoneNumberId && b.whatsappAccessToken) {
      let token: string;
      try {
        token = decryptSecret(b.whatsappAccessToken);
      } catch (err) {
        console.log(`    Meta: cannot check — token will not decrypt (${(err as Error).message})`);
        console.log("");
        continue;
      }
      console.log(`    ${await askMeta(b.whatsappPhoneNumberId, token)}`);
    } else {
      console.log("    Meta: not checked — no phone number id or no token stored");
    }
    console.log("");
  }
}

main()
  .catch((err) => {
    console.error("✖", (err as Error).message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
