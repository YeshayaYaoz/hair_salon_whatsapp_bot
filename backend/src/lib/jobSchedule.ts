import type { JobStatus } from "./jobStatus.js";

/**
 * How often each tracked job is expected to run — the one table the watchdog and the health
 * digest judge staleness against.
 *
 * SystemJobRun records what ran. Nothing recorded what did NOT run: a job whose timer died with a
 * crashed interval, or that threw on every tick, was invisible until someone happened to open the
 * job-status page. The health digest did check, but against a flat "no success in 24 hours" —
 * which cannot notice a 12-minute job that has been stuck for three hours, and by then that job
 * (depositExpiry) has been holding slots hostage the whole afternoon.
 *
 * server.ts is still where the timers live; a test asserts that every job registered there is in
 * this table and vice versa, so the two cannot drift apart silently.
 */
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export const JOB_INTERVALS_MS: Record<string, number> = {
  reminders: HOUR_MS,
  reviews: HOUR_MS,
  digest: HOUR_MS,
  roiReport: HOUR_MS,
  billingReminder: HOUR_MS,
  healthDigest: HOUR_MS,
  aiCostAlert: HOUR_MS,
  subscriptionBilling: HOUR_MS,
  yieldCampaign: HOUR_MS,
  voiceUsage: HOUR_MS,
  voiceBudget: HOUR_MS,
  jobWatchdog: HOUR_MS,
  depositExpiry: 12 * MINUTE_MS,
  inboundRecovery: 2 * MINUTE_MS,
  whatsappHealth: 6 * HOUR_MS,
  metricSnapshot: DAY_MS,
  retention: DAY_MS,
  voiceNumberRenewal: DAY_MS,
};

/** Nothing is judged stale under this, however short its interval: a 2-minute job that is 3
 * minutes late is a busy event loop, not an outage. */
const MIN_STALE_MS = 10 * MINUTE_MS;

export interface StaleJob {
  jobName: string;
  reason: string;
}

const fmt = (ms: number) => (ms >= HOUR_MS ? `${Math.round(ms / HOUR_MS)}h` : `${Math.round(ms / MINUTE_MS)}m`);

/**
 * Every job that is late by more than twice its own interval, or whose last run failed. A job
 * with no row at all counts only once the process has been up long enough that it should have
 * run — otherwise every deploy would report the whole table missing for its first few minutes.
 *
 * Pure, so it can be tested with a clock and a list rather than a database.
 */
export function findStaleJobs(statuses: JobStatus[], now: Date, uptimeMs: number): StaleJob[] {
  const byName = new Map(statuses.map((s) => [s.jobName, s]));
  const stale: StaleJob[] = [];

  for (const [jobName, interval] of Object.entries(JOB_INTERVALS_MS)) {
    if (jobName === "jobWatchdog") continue; // cannot report on itself; the digest covers it
    const threshold = Math.max(2 * interval, MIN_STALE_MS);
    const status = byName.get(jobName);

    if (!status) {
      if (uptimeMs > threshold) stale.push({ jobName, reason: "never recorded a run" });
      continue;
    }
    const sinceRun = now.getTime() - new Date(status.lastRunAt).getTime();
    if (sinceRun > threshold) {
      stale.push({ jobName, reason: `no run for ${fmt(sinceRun)} (expected every ${fmt(interval)})` });
    } else if (status.lastStatus !== "ok") {
      stale.push({ jobName, reason: `last run failed: ${status.lastError ?? "unknown error"}` });
    }
  }
  return stale;
}
