/**
 * Fail fast on missing required configuration. Without this, a missing env var (e.g.
 * JWT_SECRET) would only surface as a cryptic runtime error the first time some unlucky
 * request hits that code path — potentially hours after a bad deploy, and hard to diagnose
 * from the stack trace alone. Checking once at boot turns that into an immediate, readable
 * startup failure in the Railway deploy logs.
 */

interface RequiredVar {
  name: string;
  description: string;
}

const REQUIRED: RequiredVar[] = [
  { name: "DATABASE_URL", description: "Postgres connection string" },
  { name: "JWT_SECRET", description: "signs dashboard login sessions" },
  { name: "TOKEN_ENCRYPTION_KEY", description: "encrypts stored WhatsApp/Google tokens at rest" },
  { name: "ANTHROPIC_API_KEY", description: "powers the WhatsApp booking bot" },
];

// Not required to boot, but silently degrade a feature if missing — warn so it's visible
// in logs instead of discovered via a support ticket.
const RECOMMENDED: RequiredVar[] = [
  { name: "DIRECT_URL", description: "Neon's non-pooled connection string — used only for deploy-time migrations (pooled DATABASE_URL hangs on prisma migrate's advisory lock)" },
  { name: "GOOGLE_CLIENT_ID", description: "shared by Google Calendar connect and \"Sign in with Google\"" },
  { name: "GOOGLE_CLIENT_SECRET", description: "shared by Google Calendar connect and \"Sign in with Google\"" },
  { name: "GOOGLE_REDIRECT_URI", description: "OAuth callback for the Settings-page \"connect Calendar\" flow (an already-logged-in business)" },
  { name: "GOOGLE_LOGIN_REDIRECT_URI", description: "OAuth callback for \"Sign in with Google\" on the login page (unauthenticated) — must be a separate registered redirect URI from GOOGLE_REDIRECT_URI" },
  { name: "META_APP_ID", description: "same Meta app as WHATSAPP_APP_SECRET — required to exchange the WhatsApp Embedded Signup code for an access token" },
  { name: "CARTESIA_TOOL_SECRET", description: "shared bearer secret Cartesia's voice agent sends when calling POST /api/voice/context — without it, that endpoint rejects every request" },
  { name: "CARTESIA_API_KEY", description: "lets us call Cartesia's management API to attach a salon's number to the voice agent — without it that step is skipped and the salon's line answers and hangs up" },
  { name: "CARTESIA_AGENT_ID", description: "the single shared voice agent every salon's number is pointed at — number assignment cannot run without it" },
  { name: "CARTESIA_SIP_PROVIDER_ID", description: "SIP trunk a salon's Israeli number is imported from (Cartesia provisions US numbers only) — without it every voice number must be imported by hand in Cartesia first" },
  // Silently defaults to http://localhost:3000, so a production deploy without it still sends
  // password-reset and email-verification mail successfully — with links nobody outside the server
  // can open. The failure is invisible until an owner reports the link not working.
  { name: "APP_URL", description: "public base URL used in every emailed link (password reset, email verification, trial signup) — without it links fall back to localhost and are unusable" },
  { name: "TORI_OUTREACH_PHONE_NUMBER_ID", description: "Tori's own WABA for Lead Finder WhatsApp broadcasts — the whatsapp broadcast channel fails at send time without it" },
  { name: "TORI_OUTREACH_ACCESS_TOKEN", description: "access token for Tori's own outreach WABA (Lead Finder WhatsApp broadcasts)" },
  { name: "WHATSAPP_OWNER_ALERT_TEMPLATE", description: "Meta-approved UTILITY template (one {{1}} body variable) for owner alerts when the owner's own 24h window is closed — without it those alerts fall back to the business's own email rather than silently dying in transit on WhatsApp (error 131047), which makes RESEND_API_KEY the only thing carrying them" },
  { name: "TORI_VOICE_IDS", description: "comma-separated ids of the two agent voices (masculine, feminine) — without it the Bot page offers every Hebrew voice, including ones no deployed agent speaks in" },
  { name: "OUTREACH_REPLY_TO", description: "mailbox that receives replies and opt-out requests to cold outreach email — the email broadcast channel refuses to send without it" },
  { name: "TORI_OUTREACH_TEMPLATE_NAME", description: "Meta-approved MARKETING template used for cold WhatsApp outreach — free-form text to a cold number is blocked (error 131047)" },
  { name: "DEEPSEEK_API_KEY", description: "lets a business opt their WhatsApp bot into DeepSeek instead of Claude (Bot settings page) — without it, that provider choice fails at send time" },
  { name: "WHATSAPP_APP_SECRET", description: "verifies WhatsApp webhook signatures, and (as the Meta app secret) exchanges the Embedded Signup code for an access token" },
  { name: "WHATSAPP_VERIFY_TOKEN", description: "required for Meta to verify the webhook URL" },
  { name: "UPLOADS_DIR", description: "mount path of the Railway volume holding owner-uploaded unit photos — without it uploads land on the container's ephemeral disk and vanish on the next deploy" },
  { name: "PAYPLUS_API_KEY", description: "Tori's own PayPlus account — recurring subscription billing" },
  { name: "PAYPLUS_SECRET_KEY", description: "Tori's own PayPlus account — recurring subscription billing" },
  { name: "PUBLIC_BACKEND_URL", description: "public URL of THIS backend — sent to PayPlus as refURL_callback so a payment is confirmed server-to-server, not only when the customer's browser returns. Falls back to APP_URL, which points at the dashboard and is usually a different host" },
  { name: "PAYPLUS_BILLING_WEBHOOK_SECRET", description: "shared secret in the subscription webhook URL (/webhook/billing/payplus/<secret>) — without it the endpoint rejects every call, and subscriptions never activate after payment" },
  { name: "PAYPLUS_PAGE_UID", description: "uid of the PayPlus payment page to render for subscription checkout — PayPlus rejects every generateLink call without it (405 not-authorize-missing-payment-page-uid), so subscriptions cannot be bought until it's set" },
  { name: "PAYPLUS_TERMINAL_UID", description: "PayPlus terminal uid — required by Transactions/Charge for every saved-card charge. Without it first payments succeed (hosted page) and every RENEWAL fails, which is the quietest way to stop getting paid" },
  { name: "PAYPLUS_CASHIER_UID", description: "PayPlus cashier uid — required alongside PAYPLUS_TERMINAL_UID for saved-card charges" },
  // NOTE: managed *payment clearing* is disabled at the API layer (see businessRoutes.ts) — third-
  // party card clearing through Tori's own merchant account is contractually/legally not allowed.
  // These stay only for Tori's own subscription billing, not for clearing on behalf of salons.
  { name: "TORI_MANAGED_PAYMENT_API_KEY", description: "Tori's own PayPlus account (subscription billing only — NOT salon clearing)" },
  { name: "TORI_MANAGED_PAYMENT_SECRET_KEY", description: "Tori's own PayPlus account (subscription billing only — NOT salon clearing)" },
  { name: "TORI_MANAGED_INVOICE_API_KEY", description: "\"Managed\" invoicing option for salons without their own Green Invoice account" },
  { name: "TORI_MANAGED_INVOICE_SECRET_KEY", description: "\"Managed\" invoicing option for salons without their own Green Invoice account" },
  { name: "SUPER_ADMIN_EMAIL", description: "your account email — unlocks the /dashboard/admin businesses list" },
  { name: "RESEND_API_KEY", description: "transactional emails (welcome, password reset)" },
  { name: "OPENAI_API_KEY", description: "two uses: voice-note transcription in the WhatsApp bot (Whisper), and the optional OpenAI provider choice on the Bot settings page" },
  { name: "CARTESIA_API_KEY", description: "Cartesia management API key — lets the dashboard point a salon's voice number at the shared agent. Without it that assignment is manual, and a number with no agent answers the call and hangs up immediately" },
  { name: "CARTESIA_AGENT_ID", description: "the one voice agent every salon shares — per-salon behaviour comes from /api/voice/context at call time, not from separate agents" },
  { name: "GOOGLE_PLACES_API_KEY", description: "Lead Finder business discovery (Google Places API) — discovery fails with a clear error if unset" },
  { name: "WHATSAPP_REMINDER_TEMPLATE", description: "approved template name for appointment reminders — without it, reminders to customers outside the 24h window are not delivered" },
  { name: "WHATSAPP_REVIEW_TEMPLATE", description: "approved template name for post-visit review requests — without it, review requests outside the 24h window are not delivered" },
];

/**
 * Names that are easy to get subtly wrong, mapped to what the code actually reads.
 *
 * A misnamed variable is worse than a missing one: the value is visibly set in the Railway UI, so
 * everything looks configured, and the failure surfaces much later as a provider error with no
 * obvious connection to a typo. PAYPLUS_UID_PAGE for PAYPLUS_PAGE_UID cost a round of debugging a
 * PayPlus 405; this turns the next one into a line in the startup log.
 */
const COMMON_TYPOS: Record<string, string> = {
  PAYPLUS_UID_PAGE: "PAYPLUS_PAGE_UID",
  PAYPLUS_PAGE_ID: "PAYPLUS_PAGE_UID",
  UPLOAD_DIR: "UPLOADS_DIR",
  DIRECT_DATABASE_URL: "DIRECT_URL",
  APP_URL_BASE: "APP_URL",
};

function reportLikelyTypos(): void {
  const found = Object.entries(COMMON_TYPOS).filter(([wrong, right]) => process.env[wrong] && !process.env[right]);
  if (found.length === 0) return;
  console.warn("\n⚠ Environment variables that look misnamed — the app is NOT reading these:\n");
  for (const [wrong, right] of found) console.warn(`  - ${wrong} is set, but the app reads ${right}. Rename it.`);
  console.warn("");
}

export function validateEnv(): void {
  const missing = REQUIRED.filter((v) => !process.env[v.name]);
  if (missing.length > 0) {
    console.error("\n✖ Missing required environment variables — refusing to start:\n");
    for (const v of missing) console.error(`  - ${v.name}  (${v.description})`);
    console.error("\nSet these in Railway's Variables tab and redeploy.\n");
    process.exit(1);
  }

  reportLikelyTypos();

  reportBillingWebhookProblems();

  const missingRecommended = RECOMMENDED.filter((v) => !process.env[v.name]);
  if (missingRecommended.length > 0) {
    console.warn("\n⚠ Missing recommended environment variables (features will degrade silently):\n");
    for (const v of missingRecommended) console.warn(`  - ${v.name}  (${v.description})`);
    console.warn("");
  }
}

/**
 * Checks the shape of the billing webhook secret, and prints the exact callback URL to register.
 *
 * Presence alone is not enough here, because every way this goes wrong is silent. The secret is a
 * URL path segment: put a "/", "?", "#" or a space in it and the route simply never matches, so
 * PayPlus's callback 404s and the payment is taken while nothing is activated or credited. A
 * pasted trailing newline does the same the moment the URL is typed into PayPlus by hand.
 *
 * And the URL itself has to be assembled from two variables and a literal path, which is exactly
 * the kind of thing that gets one character wrong. Printing it means it can be copied, not derived.
 */
function reportBillingWebhookProblems(): void {
  const raw = process.env.PAYPLUS_BILLING_WEBHOOK_SECRET;
  if (!raw) return; // already covered by the RECOMMENDED list above

  const problems: string[] = [];
  if (raw !== raw.trim()) {
    problems.push("it has leading or trailing whitespace — almost certainly a paste artefact, and it silently becomes part of the URL");
  }
  const secret = raw.trim();
  if (!/^[A-Za-z0-9._~-]+$/.test(secret)) {
    problems.push('it contains characters that are not safe in a URL path (use only letters, digits, and " - _ . ~ ")');
  }
  if (secret.length < 16) {
    problems.push(`it is only ${secret.length} characters — this is the sole thing standing between the public internet and free subscriptions; use 32+`);
  }

  if (problems.length > 0) {
    console.error("\n✖ PAYPLUS_BILLING_WEBHOOK_SECRET is set but unusable as a URL path segment:\n");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("\n  PayPlus's callback will 404, so payments will be taken and nothing activated.\n");
    return;
  }

  const base = (process.env.PUBLIC_BACKEND_URL ?? process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return; // the storage check already complains loudly about a missing public base
  const withScheme = /^https?:\/\//i.test(base) ? base : `https://${base}`;
  // Nothing to configure in PayPlus's dashboard for this one: refURL_callback is sent on every
  // generateLink call (see payplusSubscription.ts), so the URL travels with each transaction.
  // Printed anyway — it is the address to curl when a payment goes through and nothing activates.
  console.log(`[billing] PayPlus subscription callback (sent per-transaction, no PayPlus-side setup needed):\n          ${withScheme}/webhook/billing/payplus/${secret}`);
}
