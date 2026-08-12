/**
 * Reads — and, with --apply, extends — the Meta app's webhook field subscription.
 *
 * Usage (from backend/, against the environment holding the app credentials):
 *   railway run npx tsx scripts/meta-webhook-fields.ts            # read only
 *   railway run npx tsx scripts/meta-webhook-fields.ts --apply    # add missing fields
 *
 * Why this needs its own script rather than the System User token used elsewhere: subscribing an
 * app to webhook fields is an app-level operation, and Meta answers a System User token with
 * "(#190) Application Secret required for this endpoint". The app secret is already in this
 * environment for verifying inbound webhook signatures, so the app access token can be formed here
 * and nowhere else.
 *
 * WHY THIS IS WRITTEN READ-FIRST: POST /{app-id}/subscriptions *replaces* the configuration for an
 * object — it is not an "add this field" call. Posting a field list without the ones already there
 * would unsubscribe the `messages` field, and the bot would stop receiving customer messages
 * entirely while every dashboard still showed a healthy connection. So the current configuration is
 * read, the wanted fields are merged into it, and the callback URL and verify token are carried
 * across unchanged.
 *
 * The field this exists for is `message_template_status_update`: without it, Meta's verdict on the
 * templates submitted at connect reaches nobody, and a rejected template silently stops delivering
 * reminders the moment a customer's 24h window closes.
 */

const WANTED_FIELDS = ["messages", "message_template_status_update"];

const GRAPH = "https://graph.facebook.com/v23.0";
const appId = (process.env.META_APP_ID ?? process.env.WHATSAPP_APP_ID)?.trim();
const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
const apply = process.argv.includes("--apply");

if (!appId || !appSecret) {
  console.error("META_APP_ID and WHATSAPP_APP_SECRET must both be set in this environment.");
  process.exit(1);
}

const appToken = `${appId}|${appSecret}`;

type Subscription = { object: string; callback_url?: string; fields?: Array<{ name: string }>; active?: boolean };

async function readSubscriptions(): Promise<Subscription[]> {
  const res = await fetch(`${GRAPH}/${appId}/subscriptions?access_token=${encodeURIComponent(appToken)}`);
  const body = (await res.json()) as { data?: Subscription[]; error?: { message?: string } };
  if (!res.ok || body.error) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return body.data ?? [];
}

async function main() {
  const subs = await readSubscriptions();
  const waba = subs.find((s) => s.object === "whatsapp_business_account");

  console.log("Current subscriptions:");
  for (const s of subs) {
    console.log(`  ${s.object}${s.active === false ? " (inactive)" : ""}`);
    console.log(`    callback: ${s.callback_url ?? "(none)"}`);
    console.log(`    fields:   ${(s.fields ?? []).map((f) => f.name).join(", ") || "(none)"}`);
  }

  const current = (waba?.fields ?? []).map((f) => f.name);
  const missing = WANTED_FIELDS.filter((f) => !current.includes(f));

  if (missing.length === 0) {
    console.log("\n✔ Nothing missing — every wanted field is already subscribed.");
    return;
  }
  console.log(`\nMissing: ${missing.join(", ")}`);

  if (!apply) {
    console.log("Read-only run. Re-run with --apply to add them.");
    return;
  }

  // Refusing rather than guessing: a callback URL invented here would point Meta's deliveries at
  // nothing, and the symptom is a bot that stops answering with no error anywhere.
  const callbackUrl = waba?.callback_url;
  if (!callbackUrl) {
    console.error("\n✖ No existing callback URL to preserve. Set the subscription up in the Meta console first —");
    console.error("  this script deliberately will not invent one.");
    process.exit(1);
  }
  if (!verifyToken) {
    console.error("\n✖ WHATSAPP_VERIFY_TOKEN is not set. Meta re-verifies the callback on every");
    console.error("  subscription write, and the wrong token would drop the subscription entirely.");
    process.exit(1);
  }

  // The union, not the delta: this call replaces the field list.
  const fields = [...new Set([...current, ...WANTED_FIELDS])];
  console.log(`Writing fields: ${fields.join(", ")}`);

  const res = await fetch(`${GRAPH}/${appId}/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      object: "whatsapp_business_account",
      callback_url: callbackUrl,
      verify_token: verifyToken,
      fields: fields.join(","),
      access_token: appToken,
    }),
  });
  const body = (await res.json()) as { success?: boolean; error?: { message?: string } };
  if (!res.ok || body.error) {
    console.error(`\n✖ Subscription update failed: ${body.error?.message ?? `HTTP ${res.status}`}`);
    console.error("  The previous subscription is unchanged — Meta applies this call atomically.");
    process.exit(1);
  }

  const after = (await readSubscriptions()).find((s) => s.object === "whatsapp_business_account");
  const now = (after?.fields ?? []).map((f) => f.name);
  console.log(`\n✔ Now subscribed: ${now.join(", ")}`);
  const stillMissing = WANTED_FIELDS.filter((f) => !now.includes(f));
  if (stillMissing.length) {
    console.error(`✖ Still missing after the write: ${stillMissing.join(", ")}`);
    process.exit(1);
  }
  // The one that would be catastrophic to have lost, stated explicitly rather than left to be read
  // out of the list above.
  console.log(now.includes("messages") ? "✔ 'messages' is still subscribed — the bot keeps receiving customer messages." : "✖ 'messages' IS MISSING — the bot will not receive messages. Restore it immediately.");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
