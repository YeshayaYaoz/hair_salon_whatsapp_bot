import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { findStaleJobs, JOB_INTERVALS_MS, HOUR_MS, MINUTE_MS } from "./jobSchedule.js";
import type { JobStatus } from "./jobStatus.js";

const NOW = new Date("2026-09-15T12:00:00Z");
const ran = (jobName: string, agoMs: number, lastStatus = "ok", lastError: string | null = null): JobStatus => ({
  jobName,
  lastRunAt: new Date(NOW.getTime() - agoMs),
  lastStatus,
  lastError,
  lastDurationMs: 10,
});
/** Every job healthy — the baseline the cases below break one job away from. */
const allHealthy = (): JobStatus[] =>
  Object.keys(JOB_INTERVALS_MS).map((name) => ran(name, 30 * 1000));
const uptimeLong = 24 * HOUR_MS;

/**
 * The digest used to judge every job against "no success in 24 hours". That threshold is the
 * whole bug: depositExpiry runs every 12 minutes and was invisible for a day when stuck. Each job
 * is now judged against twice its own interval.
 */
describe("findStaleJobs", () => {
  it("reports nothing when every job ran recently and succeeded", () => {
    expect(findStaleJobs(allHealthy(), NOW, uptimeLong)).toEqual([]);
  });

  it("flags a 12-minute job that has been silent for an hour — the case the flat day missed", () => {
    const statuses = allHealthy().map((s) => (s.jobName === "depositExpiry" ? ran("depositExpiry", HOUR_MS) : s));
    const stale = findStaleJobs(statuses, NOW, uptimeLong);
    expect(stale.map((s) => s.jobName)).toEqual(["depositExpiry"]);
    expect(stale[0].reason).toContain("expected every 12m");
  });

  it("does not flag an hourly job that is merely 90 minutes late — under twice its interval", () => {
    const statuses = allHealthy().map((s) => (s.jobName === "reminders" ? ran("reminders", 90 * MINUTE_MS) : s));
    expect(findStaleJobs(statuses, NOW, uptimeLong)).toEqual([]);
  });

  it("never judges a short job stale under ten minutes, however small its interval", () => {
    // inboundRecovery runs every 2 minutes; 8 minutes late is a busy loop, not an outage.
    const statuses = allHealthy().map((s) => (s.jobName === "inboundRecovery" ? ran("inboundRecovery", 8 * MINUTE_MS) : s));
    expect(findStaleJobs(statuses, NOW, uptimeLong)).toEqual([]);
  });

  it("flags a job whose last run failed even if it was recent", () => {
    const statuses = allHealthy().map((s) => (s.jobName === "reviews" ? ran("reviews", 60_000, "error", "boom") : s));
    const stale = findStaleJobs(statuses, NOW, uptimeLong);
    expect(stale).toEqual([{ jobName: "reviews", reason: "last run failed: boom" }]);
  });

  it("flags a job with no row only once the process has been up long enough to have run it", () => {
    const missingOne = allHealthy().filter((s) => s.jobName !== "whatsappHealth"); // 6h interval
    // Fresh deploy: the row is legitimately absent.
    expect(findStaleJobs(missingOne, NOW, 5 * MINUTE_MS)).toEqual([]);
    // A day up with no row: the timer never fired.
    expect(findStaleJobs(missingOne, NOW, uptimeLong)).toEqual([{ jobName: "whatsappHealth", reason: "never recorded a run" }]);
  });

  it("does not report on itself", () => {
    const statuses = allHealthy().filter((s) => s.jobName !== "jobWatchdog");
    expect(findStaleJobs(statuses, NOW, uptimeLong)).toEqual([]);
  });
});

/**
 * server.ts owns the timers and this table owns the expectations. Neither can be allowed to
 * drift: a job registered without an entry here is invisible to the watchdog, and an entry with
 * no timer would be reported stale forever. Read the source, compare the sets, both directions.
 */
describe("the interval table matches what server.ts actually schedules", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const registered = new Set([...source.matchAll(/runTrackedJob\("([a-zA-Z]+)"/g)].map((m) => m[1]));
  const tabled = new Set(Object.keys(JOB_INTERVALS_MS));

  it("every job server.ts runs has an expected interval", () => {
    expect([...registered].filter((n) => !tabled.has(n))).toEqual([]);
  });

  it("every interval in the table belongs to a job server.ts runs", () => {
    expect([...tabled].filter((n) => !registered.has(n))).toEqual([]);
  });
});
