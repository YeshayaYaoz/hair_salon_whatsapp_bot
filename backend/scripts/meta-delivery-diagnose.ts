/**
 * Why an accepted message is not delivered.
 *
 * Usage (from backend/, against the environment holding the credentials):
 *   railway run npx tsx scripts/meta-delivery-diagnose.ts
 *
 * Read-only. Exists because a 200 from the send endpoint means "queued", not "delivered": Meta
 * accepts the call and then drops the message for reasons that live on the account rather than in
 * the request — a WABA under review, a business not verified, an app not subscribed to the WABA,
 * a spending cap. None of those produce an error at send time, and the send log looks identical
 * to a healthy one.
 *
 * Several of these edges require an appsecret_proof, which is why this runs through `railway run`:
 * WHATSAPP_APP_SECRET lives in the backend service's variables and never needs copying elsewhere.
 */

import { createHmac } from "node:crypto";

const GRAPH = "https://graph.facebook.com/v23.0";

const token = (process.env.META_SYSTEM_USER_TOKEN ?? process.env.TORI_OUTREACH_ACCESS_TOKEN)?.trim();
const wabaId = (process.env.TORI_WABA_ID ?? process.env.WHATSAPP_WABA_ID)?.trim();
const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
const phoneNumberId = process.env.TORI_OUTREACH_PHONE_NUMBER_ID?.trim();

if (!token || !wabaId) {
  console.error("META_SYSTEM_USER_TOKEN and TORI_WABA_ID must both be set.");
  process.exit(1);
}

/** Meta requires this on app-level edges: HMAC-SHA256 of the access token, keyed by the app secret. */
const proof = appSecret ? createHmac("sha256", appSecret).update(token).digest("hex") : null;

async function get(path: string, fields?: string, withProof = false): Promise<any> {
  const params = new URLSearchParams({ access_token: token! });
  if (fields) params.set("fields", fields);
  if (withProof && proof) params.set("appsecret_proof", proof);
  const res = await fetch(`${GRAPH}${path}?${params}`);
  return res.json();
}

function show(label: string, value: unknown) {
  console.log(`  ${label.padEnd(34)} ${value === undefined || value === null ? "—" : JSON.stringify(value)}`);
}

async function main() {
  console.log(`App secret available: ${appSecret ? "yes" : "NO — app-level edges will be unreadable"}`);
  console.log("");

  // The WABA's own standing. account_review_status and any ban state are the two that silently
  // stop delivery while every send still returns 200.
  console.log("WhatsApp Business Account:");
  const waba = await get(
    `/${wabaId}`,
    "id,name,account_review_status,business_verification_status,country,currency,ownership_type,primary_funding_id,timezone_id,health_status"
  );
  if (waba.error) {
    console.log(`  error: ${waba.error.message}`);
  } else {
    show("name", waba.name);
    show("account_review_status", waba.account_review_status);
    show("business_verification_status", waba.business_verification_status);
    show("ownership_type", waba.ownership_type);
    show("primary_funding_id", waba.primary_funding_id ? "set" : null);
    if (waba.health_status) console.log(`  health_status: ${JSON.stringify(waba.health_status, null, 2)}`);
  }
  console.log("");

  // Meta's own answer to "can this number send right now", per entity. This is the single most
  // direct read on the question and it is not exposed anywhere in the send path.
  console.log("Health status (can it send, per entity):");
  const health = await get(`/${wabaId}`, "health_status");
  if (health.error) console.log(`  error: ${health.error.message}`);
  else console.log(JSON.stringify(health.health_status ?? "not returned", null, 2));
  console.log("");

  // An app that is not subscribed to the WABA receives no delivery status callbacks at all — which
  // is exactly the state where "accepted" is the last thing anyone ever learns about a message.
  console.log("Apps subscribed to this WABA:");
  const subs = await get(`/${wabaId}/subscribed_apps`, undefined, true);
  if (subs.error) console.log(`  error: ${subs.error.message}`);
  else if (!subs.data?.length) console.log("  NONE — no app receives delivery statuses for this account.");
  else for (const s of subs.data) console.log(`  - ${s.whatsapp_business_api_data?.name ?? s.whatsapp_business_api_data?.id}`);
  console.log("");

  console.log("Webhook fields the app subscribes to:");
  const appId = (await get(`/debug_token`, undefined))?.data?.app_id
    ?? (await (await fetch(`${GRAPH}/debug_token?input_token=${token}&access_token=${token}`)).json())?.data?.app_id;
  const appSubs = appId ? await get(`/${appId}/subscriptions`, undefined, true) : { error: { message: "no app id" } };
  if (appSubs.error) console.log(`  error: ${appSubs.error.message}`);
  else
    for (const s of appSubs.data ?? []) {
      console.log(`  ${s.object}: ${(s.fields ?? []).map((f: { name: string }) => f.name).join(", ")}`);
      // Without this field nothing ever learns a message failed — the whole class of silent
      // non-delivery is invisible by configuration, not by accident.
      if (s.object === "whatsapp_business_account" && !(s.fields ?? []).some((f: { name: string }) => f.name === "messages")) {
        console.log("  ⚠ 'messages' is NOT subscribed — delivery failures cannot reach us.");
      }
    }
  console.log("");

  if (phoneNumberId) {
    console.log("Sending number:");
    const pn = await get(
      `/${phoneNumberId}`,
      "display_phone_number,verified_name,status,quality_rating,throughput,messaging_limit_tier,code_verification_status,platform_type,is_official_business_account"
    );
    if (pn.error) console.log(`  error: ${pn.error.message}`);
    else for (const [k, v] of Object.entries(pn)) if (k !== "id") show(k, v);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
