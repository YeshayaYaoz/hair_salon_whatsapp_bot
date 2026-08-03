import "dotenv/config";
import express from "express";
import cors from "cors";
import { validateEnv } from "./lib/validateEnv.js";
import { initErrorMonitoring, captureError } from "./lib/errorMonitoring.js";
import { authRouter } from "./api/authRoutes.js";
import { businessRouter } from "./api/businessRoutes.js";
import { whatsappRouter } from "./webhook/whatsappRoutes.js";
import { publicRouter } from "./api/publicRoutes.js";
import { paymentWebhookRouter } from "./webhook/paymentWebhooks.js";
import { payplusBillingRouter, payplusBillingWebhookRouter } from "./billing/payplusBillingRoutes.js";
import { runSubscriptionBillingJob } from "./billing/subscriptionBillingJob.js";
import { runBillingReminderJob } from "./billing/billingReminderJob.js";
import { runYieldCampaignJob } from "./billing/yieldCampaignJob.js";
import { runRetentionJob } from "./lib/retentionJob.js";
import { runReminderJob, runReviewJob, runDigestJob, runRoiReportJob } from "./lib/scheduledMessages.js";
import { runDepositExpiryJob } from "./lib/depositExpiryJob.js";
import { runMetricSnapshotJob } from "./billing/metricSnapshotJob.js";
import { runWhatsAppHealthJob } from "./lib/whatsappHealthJob.js";
import { runTrackedJob } from "./lib/jobStatus.js";
import { runHealthDigestJob } from "./lib/healthDigest.js";
import { leadFinderRouter } from "./leadfinder/routes.js";
import { voiceRouter } from "./api/voiceRoutes.js";
import { UPLOADS_ROUTE, UPLOADS_ROOT, UnsupportedImageError, MAX_UPLOAD_BYTES, checkUploadsDir } from "./lib/storage.js";
import multer from "multer";

validateEnv(); // exits the process before anything binds to a port if required config is missing
initErrorMonitoring();
// Non-blocking: a misconfigured uploads dir breaks photos, not the whole app, so it reports and
// lets everything else start rather than taking the bot down with it.
void checkUploadsDir();

// Surface crashes that slip past every try/catch instead of dying silently in a Railway log.
process.on("uncaughtException", (err) => {
  console.error("[fatal] Uncaught exception:", err);
  captureError(err, { kind: "uncaughtException" });
  process.exit(1); // process state is untrusted after this — let Railway restart cleanly
});
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] Unhandled rejection:", reason);
  captureError(reason, { kind: "unhandledRejection" });
});

const app = express();
const allowedOrigins = (process.env.FRONTEND_URL ?? "*").split(",").map(o => o.trim());
app.use(cors({
  origin: allowedOrigins.length === 1 && allowedOrigins[0] === "*" ? "*" : allowedOrigins,
  credentials: true,
}));

// Routes that need the raw, unparsed body for signature verification must be mounted
// before the global express.json() middleware below would otherwise consume the stream.
app.use("/webhook/whatsapp", whatsappRouter);

// Default 100kb is too small for a base64-encoded profile-picture upload (see
// POST /api/business/me/whatsapp/profile-picture) — 6mb gives headroom over the ~33% base64
// overhead on a client-resized image without opening the door to arbitrarily large bodies.
app.use(express.json({ limit: "6mb" }));
app.use(express.urlencoded({ extended: true })); // Tranzila's notify webhook posts form-encoded, not JSON

app.use("/webhook/payments", paymentWebhookRouter);
app.use("/webhook/billing/payplus", payplusBillingWebhookRouter);

// Owner-uploaded unit photos. Served straight off the Railway volume: WhatsApp fetches these URLs
// itself when the bot sends an image, so they have to be publicly readable with no auth. The
// filenames are random, and nothing sensitive is ever stored here — only photos the owner intends
// customers to see. immutable caching is safe because a file is never rewritten, only replaced
// under a new random name.
app.use(
  UPLOADS_ROUTE,
  express.static(UPLOADS_ROOT, {
    maxAge: "365d",
    immutable: true,
    index: false,
    dotfiles: "deny",
    // Without this, a request for a path that isn't a file falls through to the API routers below
    // and answers with a JSON 404 that looks like an API error.
    fallthrough: false,
  })
);

app.use("/api/auth", authRouter);
app.use("/api/public", publicRouter);
app.use("/api/business", businessRouter);
app.use("/api/billing", payplusBillingRouter);
app.use("/api/leadfinder", leadFinderRouter);
app.use("/api/voice", voiceRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

// Safety net for anything a route handler passes to next(err) or throws synchronously —
// individual routes already handle their own errors, this just ensures nothing falls through
// to Express's default (unmonitored) error page.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Upload failures are the owner's problem to fix, not ours to swallow as a 500: an oversized
  // photo or an unsupported file needs to come back as something they can act on.
  if (err instanceof UnsupportedImageError) {
    return res.status(400).json({ error: err.message });
  }
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? `הקובץ גדול מדי. הגודל המרבי הוא ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB לתמונה.`
        : err.code === "LIMIT_FILE_COUNT"
          ? "אפשר להעלות עד 10 תמונות בבת אחת."
          : "העלאת הקובץ נכשלה. נסו שוב.";
    return res.status(400).json({ error: message });
  }

  console.error("[express] Unhandled route error:", err);
  captureError(err, { kind: "expressErrorHandler" });
  if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Backend listening on :${port}`));

// Run retention job daily at 10:00 Jerusalem time
function scheduleRetentionJob() {
  const now = new Date();
  const next = new Date();
  next.setUTCHours(8, 0, 0, 0); // 10:00 Jerusalem (UTC+2) = 08:00 UTC
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next.getTime() - now.getTime();
  setTimeout(() => {
    runTrackedJob("retention", runRetentionJob);
    runTrackedJob("subscriptionBilling", runSubscriptionBillingJob);
    setInterval(() => {
      runTrackedJob("retention", runRetentionJob);
      runTrackedJob("subscriptionBilling", runSubscriptionBillingJob);
    }, 24 * 60 * 60 * 1000);
  }, delay);
  console.log(`[retention] Next run scheduled in ${Math.round(delay / 60000)} minutes`);
}
scheduleRetentionJob();

// Run reminder, review, and digest jobs every hour
const ONE_HOUR = 60 * 60 * 1000;
setInterval(() => {
  runTrackedJob("reminders", runReminderJob);
  runTrackedJob("reviews", runReviewJob);
  runTrackedJob("digest", runDigestJob);
  runTrackedJob("roiReport", runRoiReportJob);
  runTrackedJob("billingReminder", runBillingReminderJob);
  runTrackedJob("healthDigest", runHealthDigestJob);
}, ONE_HOUR);
// Also run immediately on startup to catch any missed windows
runTrackedJob("reminders", runReminderJob);
runTrackedJob("reviews", runReviewJob);
runTrackedJob("digest", runDigestJob);
runTrackedJob("roiReport", runRoiReportJob);
runTrackedJob("billingReminder", runBillingReminderJob);
runTrackedJob("healthDigest", runHealthDigestJob);

// Yield-management (empty-slot) campaign scan — runs once daily at 18:00 local business time;
// like the digest job, the underlying function itself gates on each business's local clock, so
// this just needs to fire hourly and let it self-select the right businesses each day.
setInterval(() => runTrackedJob("yieldCampaign", runYieldCampaignJob), ONE_HOUR);
runTrackedJob("yieldCampaign", runYieldCampaignJob);

// Deposit holds are short-lived (default 30 min) — check often so a slot isn't stuck blocked
// long after the customer abandoned the payment link.
//
// Twelve minutes, well clear of the ~5-minute mark at which managed Postgres (Neon) suspends its
// compute: a tick close to that boundary keeps the database awake around the clock, which is what
// exhausted a monthly compute allowance mid-month. The job itself now skips the query entirely
// when no hold is due (see depositExpiryJob.ts), so this interval is margin on top of that.
//
// The tradeoff is only latency in releasing an abandoned slot, and it is bounded by the hold window
// rather than by this number: a 30-minute hold expires at 30 minutes and is released at the next
// tick, so worst case the slot stays blocked ~12 minutes longer than strictly necessary. Nobody is
// waiting on that, and the slot was already unavailable for the whole hold anyway.
const TWELVE_MINUTES = 12 * 60 * 1000;
setInterval(() => runTrackedJob("depositExpiry", runDepositExpiryJob), TWELVE_MINUTES);
runTrackedJob("depositExpiry", runDepositExpiryJob);

const ONE_DAY = 24 * 60 * 60 * 1000;
setInterval(() => runTrackedJob("metricSnapshot", runMetricSnapshotJob), ONE_DAY);
runTrackedJob("metricSnapshot", runMetricSnapshotJob);

const SIX_HOURS = 6 * 60 * 60 * 1000;
setInterval(() => runTrackedJob("whatsappHealth", runWhatsAppHealthJob), SIX_HOURS);
runTrackedJob("whatsappHealth", runWhatsAppHealthJob);
