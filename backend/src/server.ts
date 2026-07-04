import "dotenv/config";
import express from "express";
import cors from "cors";
import { authRouter } from "./api/authRoutes.js";
import { businessRouter } from "./api/businessRoutes.js";
import { whatsappRouter } from "./webhook/whatsappRoutes.js";
import { billingRouter, stripeWebhookRouter } from "./billing/billingRoutes.js";
import { publicRouter } from "./api/publicRoutes.js";
import { runRetentionJob } from "./lib/retentionJob.js";
import { runReminderJob, runReviewJob } from "./lib/scheduledMessages.js";

const app = express();
const allowedOrigins = (process.env.FRONTEND_URL ?? "*").split(",").map(o => o.trim());
app.use(cors({
  origin: allowedOrigins.length === 1 && allowedOrigins[0] === "*" ? "*" : allowedOrigins,
  credentials: true,
}));

// Stripe webhook needs the raw, unparsed body to verify its signature, so this must be mounted
// before the global express.json() middleware below would otherwise consume the stream.
app.use("/api/billing/webhook", stripeWebhookRouter);

app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/public", publicRouter);
app.use("/api/business", businessRouter);
app.use("/api/billing", billingRouter);
app.use("/webhook/whatsapp", whatsappRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

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
    runRetentionJob().catch((err) => console.error("[retention] Job failed:", err));
    setInterval(() => {
      runRetentionJob().catch((err) => console.error("[retention] Job failed:", err));
    }, 24 * 60 * 60 * 1000);
  }, delay);
  console.log(`[retention] Next run scheduled in ${Math.round(delay / 60000)} minutes`);
}
scheduleRetentionJob();

// Run reminder and review jobs every hour
const ONE_HOUR = 60 * 60 * 1000;
setInterval(() => {
  runReminderJob().catch((err) => console.error("[reminders] Job failed:", err));
  runReviewJob().catch((err) => console.error("[reviews] Job failed:", err));
}, ONE_HOUR);
// Also run immediately on startup to catch any missed windows
runReminderJob().catch((err) => console.error("[reminders] Startup run failed:", err));
runReviewJob().catch((err) => console.error("[reviews] Startup run failed:", err));
