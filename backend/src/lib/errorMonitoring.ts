/**
 * Optional error monitoring via Sentry. Entirely no-op if SENTRY_DSN isn't set, matching
 * the codebase's existing pattern for optional integrations (Resend, Google Calendar, etc.)
 * — the app must run identically for local dev and for anyone who hasn't configured it.
 *
 * Without this, every error only reaches a Railway log line that nobody is watching in
 * real time. This surfaces failures (bot crashes, webhook errors, job failures) the moment
 * they happen instead of via a customer complaint.
 */
import * as Sentry from "@sentry/node";

let enabled = false;

export function initErrorMonitoring(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log("[monitoring] SENTRY_DSN not set — error monitoring disabled");
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "production",
    tracesSampleRate: 0.1,
  });
  enabled = true;
  console.log("[monitoring] Sentry error monitoring enabled");
}

/** Report an error to Sentry (no-op if monitoring isn't configured). Never throws. */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  try {
    Sentry.captureException(err, context ? { extra: context } : undefined);
  } catch {
    // Never let monitoring itself break the request/job it's trying to observe.
  }
}
