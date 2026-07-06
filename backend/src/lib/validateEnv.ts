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
  { name: "WHATSAPP_APP_SECRET", description: "verifies WhatsApp webhook signatures (dev mode allows unsigned requests without it)" },
  { name: "WHATSAPP_VERIFY_TOKEN", description: "required for Meta to verify the webhook URL" },
  { name: "STRIPE_SECRET_KEY", description: "subscription billing" },
  { name: "STRIPE_PRICE_ID", description: "subscription checkout" },
  { name: "STRIPE_WEBHOOK_SECRET", description: "subscription status sync" },
  { name: "PAYPLUS_API_KEY", description: "Tori's own PayPlus account — recurring subscription billing" },
  { name: "PAYPLUS_SECRET_KEY", description: "Tori's own PayPlus account — recurring subscription billing" },
  { name: "RESEND_API_KEY", description: "transactional emails (welcome, password reset)" },
  { name: "OPENAI_API_KEY", description: "voice-note transcription in the WhatsApp bot (Whisper)" },
];

export function validateEnv(): void {
  const missing = REQUIRED.filter((v) => !process.env[v.name]);
  if (missing.length > 0) {
    console.error("\n✖ Missing required environment variables — refusing to start:\n");
    for (const v of missing) console.error(`  - ${v.name}  (${v.description})`);
    console.error("\nSet these in Railway's Variables tab and redeploy.\n");
    process.exit(1);
  }

  const missingRecommended = RECOMMENDED.filter((v) => !process.env[v.name]);
  if (missingRecommended.length > 0) {
    console.warn("\n⚠ Missing recommended environment variables (features will degrade silently):\n");
    for (const v of missingRecommended) console.warn(`  - ${v.name}  (${v.description})`);
    console.warn("");
  }
}
