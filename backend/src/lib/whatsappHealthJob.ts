import { prisma } from "./prisma.js";
import { decryptSecret } from "./crypto.js";
import { sendWhatsAppTokenExpiredEmail } from "./email.js";

const GRAPH_VERSION = "v20.0";

/**
 * Proactive WhatsApp token health check. Rather than discovering a broken/expired token only when
 * the bot fails to reply to a real customer, this pings each connected business's phone number
 * against the Graph API on a schedule and flips whatsappTokenValid the moment Meta stops accepting
 * the token — emailing the owner once, on the transition, so a silent outage becomes a heads-up.
 *
 * It only ever flags a token INVALID on an actual auth rejection (a 190/OAuthException), never on
 * a network blip or a 5xx from Meta — otherwise a transient Graph outage would mass-mark every
 * business as broken and spam every owner.
 */
export async function runWhatsAppHealthJob(): Promise<void> {
  const businesses = await prisma.business.findMany({
    where: { whatsappPhoneNumberId: { not: null }, whatsappAccessToken: { not: null } },
    select: { id: true, name: true, email: true, whatsappPhoneNumberId: true, whatsappAccessToken: true, whatsappTokenValid: true },
  });

  for (const biz of businesses) {
    let accessToken: string;
    try {
      accessToken = decryptSecret(biz.whatsappAccessToken!);
    } catch (err) {
      console.error(`[whatsappHealth] Could not decrypt token for ${biz.id}:`, err);
      continue;
    }

    let authRejected = false;
    try {
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${biz.whatsappPhoneNumberId}?fields=id&access_token=${encodeURIComponent(accessToken)}`
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as any;
        const code = body?.error?.code;
        // 190 = access token expired/invalid; 10x/2xx OAuth codes are also auth failures. A plain
        // 4xx that isn't an OAuthException (e.g. rate limit 4/613) is NOT a dead token — skip it.
        if (code === 190 || body?.error?.type === "OAuthException") authRejected = true;
        else console.warn(`[whatsappHealth] Non-auth error for ${biz.id} (${res.status}):`, body?.error?.message ?? res.statusText);
      }
    } catch (err) {
      console.error(`[whatsappHealth] Network error checking ${biz.id} — leaving status unchanged:`, err);
      continue; // never flip status on a network failure
    }

    const shouldBeValid = !authRejected;
    if (shouldBeValid === biz.whatsappTokenValid) continue; // no transition — nothing to do

    await prisma.business.update({ where: { id: biz.id }, data: { whatsappTokenValid: shouldBeValid } });

    if (!shouldBeValid) {
      console.warn(`[whatsappHealth] Token for ${biz.name} (${biz.id}) is no longer valid — notifying owner`);
      await sendWhatsAppTokenExpiredEmail(biz.email, biz.name).catch((err) =>
        console.error(`[whatsappHealth] Failed to email ${biz.id} about token expiry:`, err)
      );
    } else {
      console.log(`[whatsappHealth] Token for ${biz.name} (${biz.id}) is valid again — cleared broken flag`);
    }

    await new Promise((r) => setTimeout(r, 200)); // be gentle on the Graph API across the fleet
  }
}
