"use client";

/**
 * Optional client-side error monitoring. No-op if NEXT_PUBLIC_SENTRY_DSN isn't set, so the
 * dashboard behaves identically for anyone who hasn't configured it (same pattern as the
 * backend's errorMonitoring.ts).
 */
import * as Sentry from "@sentry/browser";

let initialized = false;

export function initClientMonitoring() {
  if (initialized) return;
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({ dsn, environment: process.env.NODE_ENV ?? "production", tracesSampleRate: 0.1 });
  initialized = true;
}

export function reportClientError(err: unknown) {
  if (!initialized) return;
  try {
    Sentry.captureException(err);
  } catch {
    // Never let monitoring itself break the UI it's trying to observe.
  }
}
