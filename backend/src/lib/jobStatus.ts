import { prisma } from "./prisma.js";
import { captureError } from "./errorMonitoring.js";

/**
 * Runs a scheduled job and records its outcome so the dashboard can show "last run" / "last
 * error" instead of that information only existing in Railway logs that nobody watches live.
 * Never throws — a failed job is recorded and reported, not allowed to crash the scheduler.
 */
export async function runTrackedJob(jobName: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    await prisma.systemJobRun.upsert({
      where: { jobName },
      create: { jobName, lastRunAt: new Date(), lastStatus: "ok", lastDurationMs: Date.now() - start },
      update: { lastRunAt: new Date(), lastStatus: "ok", lastError: null, lastDurationMs: Date.now() - start },
    }).catch((err) => console.error(`[jobStatus] Failed to record success for ${jobName}:`, err));
  } catch (err) {
    console.error(`[${jobName}] Job failed:`, err);
    captureError(err, { job: jobName });
    const message = err instanceof Error ? err.message : String(err);
    await prisma.systemJobRun.upsert({
      where: { jobName },
      create: { jobName, lastRunAt: new Date(), lastStatus: "error", lastError: message, lastDurationMs: Date.now() - start },
      update: { lastRunAt: new Date(), lastStatus: "error", lastError: message, lastDurationMs: Date.now() - start },
    }).catch((dbErr) => console.error(`[jobStatus] Failed to record failure for ${jobName}:`, dbErr));
  }
}

export interface JobStatus {
  jobName: string;
  lastRunAt: Date;
  lastStatus: string;
  lastError: string | null;
  lastDurationMs: number | null;
}

export async function getJobStatuses(): Promise<JobStatus[]> {
  return prisma.systemJobRun.findMany({ orderBy: { jobName: "asc" } });
}
