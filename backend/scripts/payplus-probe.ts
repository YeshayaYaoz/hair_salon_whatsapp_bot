/**
 * Answers "does subscription billing actually reach my PayPlus account?" against the environment
 * it runs in.
 *
 * Usage (from backend/, against the production env that holds the real keys):
 *   railway run npx tsx scripts/payplus-probe.ts            # checks only
 *   railway run npx tsx scripts/payplus-probe.ts --link     # also creates a real ₪1 payment link
 *
 * What it verifies, in order of how silently each one fails:
 *
 *   1. Which PayPlus host PAYPLUS_ENV selects. "sandbox" in production means every link is created
 *      against restapidev with staging keys — pages render, nobody is ever charged, and no money
 *      arrives. This is the exact bug the Grow provider shipped with (see lib/payments/grow.ts).
 *   2. That every variable billing needs is present — including PAYPLUS_TERMINAL_UID and
 *      PAYPLUS_CASHIER_UID, without which the FIRST payment succeeds and every RENEWAL fails.
 *   3. That the billing webhook URL is live and its secret matches, using the backend's own GET
 *      self-check. A mismatched secret means PayPlus's callback 404s: the card is charged, the
 *      subscription never activates, and nothing is logged on our side.
 *   4. That the API key/secret/page uid are accepted by the selected PayPlus host, by generating a
 *      ₪1 payment link. Creating a link charges nobody — it is the same call the checkout makes.
 *
 * With --link it prints that ₪1 link. Paying it yourself is the one test no code can replace:
 * the charge should appear in the PayPlus dashboard (and land in the linked bank account on the
 * next settlement), the webhook should fire, and the business row's checkoutRef should clear.
 *
 * Everything here is read-only except the generated link, which has no financial effect unless
 * someone completes it.
 */

const env = (name: string) => process.env[name]?.trim() || "";

const sandbox = env("PAYPLUS_ENV") === "sandbox";
const BASE_URL = sandbox ? "https://restapidev.payplus.co.il/api/v1.0" : "https://restapi.payplus.co.il/api/v1.0";

function section(title: string) {
  console.log(`\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}`);
}

let failures = 0;
function check(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  section("1. Environment");
  console.log(`PAYPLUS_ENV=${env("PAYPLUS_ENV") || "(empty)"} → ${BASE_URL}`);
  check(!sandbox, "Pointing at PRODUCTION PayPlus", sandbox ? "SANDBOX selected: links render but no money ever arrives" : undefined);

  const required = [
    ["PAYPLUS_API_KEY", "checkout + renewals"],
    ["PAYPLUS_SECRET_KEY", "checkout + renewals"],
    ["PAYPLUS_PAGE_UID", "hosted checkout page"],
    ["PAYPLUS_TERMINAL_UID", "RENEWALS — first payment works without it, every renewal fails"],
    ["PAYPLUS_CASHIER_UID", "RENEWALS — first payment works without it, every renewal fails"],
    ["PAYPLUS_BILLING_WEBHOOK_SECRET", "activation after payment"],
    ["PUBLIC_BACKEND_URL", "where PayPlus posts the callback"],
  ] as const;
  for (const [name, why] of required) check(!!env(name), name, env(name) ? undefined : `MISSING (${why})`);

  section("2. Billing webhook reachability");
  const backend = env("PUBLIC_BACKEND_URL").replace(/\/$/, "");
  const secret = env("PAYPLUS_BILLING_WEBHOOK_SECRET");
  if (backend && secret) {
    const url = `${backend}/webhook/billing/payplus/${secret}`;
    try {
      const res = await fetch(url);
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
      check(res.status === 200 && body.ok === true, "Webhook live and secret matches",
        res.status === 200 ? undefined : `GET returned ${res.status} — PayPlus callbacks will be dropped, cards charged, nothing activated`);
    } catch (err) {
      check(false, "Webhook reachable", err instanceof Error ? err.message : String(err));
    }
  } else {
    check(false, "Webhook check skipped", "PUBLIC_BACKEND_URL or the webhook secret is missing");
  }

  section("3. Credentials accepted by PayPlus (₪1 generateLink)");
  const wantLink = process.argv.includes("--link");
  if (env("PAYPLUS_API_KEY") && env("PAYPLUS_SECRET_KEY") && env("PAYPLUS_PAGE_UID")) {
    const res = await fetch(`${BASE_URL}/PaymentPages/generateLink`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: JSON.stringify({ api_key: env("PAYPLUS_API_KEY"), secret_key: env("PAYPLUS_SECRET_KEY") }),
      },
      body: JSON.stringify({
        payment_page_uid: env("PAYPLUS_PAGE_UID"),
        charge_method: 1,
        amount: 1,
        currency_code: "ILS",
        more_info: "payplus-probe",
        customer: { customer_name: "Tori probe" },
        items: [{ name: "Tori — בדיקת חיבור (₪1)", quantity: 1, price: 1 }],
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: { payment_page_link?: string };
      results?: { status?: string; description?: string };
      message?: string;
    };
    const ok = res.ok && body.results?.status === "success" && !!body.data?.payment_page_link;
    check(ok, "API key + secret + page uid accepted",
      ok ? undefined : `HTTP ${res.status}: ${body.results?.description ?? body.message ?? "unknown"}`);
    if (ok && wantLink) {
      console.log(`\n  ₪1 test link (pay it yourself to prove the money path end to end):`);
      console.log(`  ${body.data!.payment_page_link}`);
      console.log(`  Afterwards: the charge appears in the PayPlus dashboard, and the webhook`);
      console.log(`  activation shows in the backend logs as "[payplus subscription webhook]".`);
    } else if (ok && !wantLink) {
      console.log("  (re-run with --link to print a payable ₪1 link for a live end-to-end test)");
    }
  } else {
    check(false, "generateLink check skipped", "api key / secret / page uid missing");
  }

  section("Result");
  if (failures === 0) {
    console.log("Everything this probe can verify from outside PayPlus passes.");
    console.log("The only remaining proof is paying the --link ₪1 page and seeing it in the dashboard.");
  } else {
    console.log(`${failures} check(s) failed — money will NOT reliably arrive until they are fixed.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Probe crashed:", err);
  process.exit(1);
});
