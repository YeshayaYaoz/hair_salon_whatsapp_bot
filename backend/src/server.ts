import "dotenv/config";
import express from "express";
import cors from "cors";
import { validateEnv } from "./lib/validateEnv.js";
import { initErrorMonitoring, captureError } from "./lib/errorMonitoring.js";
import { authRouter } from "./api/authRoutes.js";
import { businessRouter } from "./api/businessRoutes.js";
import { whatsappRouter } from "./webhook/whatsappRoutes.js";
import { billingRouter, stripeWebhookRouter } from "./billing/billingRoutes.js";
import { publicRouter } from "./api/publicRoutes.js";
import { runRetentionJob } from "./lib/retentionJob.js";
import { runReminderJob, runReviewJob, runDigestJob } from "./lib/scheduledMessages.js";
import { runTrackedJob } from "./lib/jobStatus.js";

validateEnv(); // exits the process before anything binds to a port if required config is missing
initErrorMonitoring();

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
app.use("/api/billing/webhook", stripeWebhookRouter);
app.use("/webhook/whatsapp", whatsappRouter);

app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/public", publicRouter);
app.use("/api/business", businessRouter);
app.use("/api/billing", billingRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

// Safety net for anything a route handler passes to next(err) or throws synchronously —
// individual routes already handle their own errors, this just ensures nothing falls through
// to Express's default (unmonitored) error page.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
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
    setInterval(() => runTrackedJob("retention", runRetentionJob), 24 * 60 * 60 * 1000);
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
}, ONE_HOUR);
// Also run immediately on startup to catch any missed windows
runTrackedJob("reminders", runReminderJob);
runTrackedJob("reviews", runReviewJob);
runTrackedJob("digest", runDigestJob);
