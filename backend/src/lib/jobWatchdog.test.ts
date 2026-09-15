import { describe, it, expect, vi, beforeEach } from "vitest";
import { HOUR_MS, JOB_INTERVALS_MS } from "./jobSchedule.js";

const mockPrisma = { systemSetting: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() } };
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
const getJobStatuses = vi.fn();
vi.mock("./jobStatus.js", () => ({ getJobStatuses: (...a: unknown[]) => getJobStatuses(...a) }));
const sendAdminAlertEmail = vi.fn();
vi.mock("./email.js", () => ({ sendAdminAlertEmail: (...a: unknown[]) => sendAdminAlertEmail(...a) }));
const countAbandonedInbound = vi.fn();
vi.mock("../webhook/whatsappInbox.js", () => ({ countAbandonedInbound: (...a: unknown[]) => countAbandonedInbound(...a) }));

const { runJobWatchdogJob } = await import("./jobWatchdog.js");

const healthy = () =>
  Object.keys(JOB_INTERVALS_MS).map((jobName) => ({ jobName, lastRunAt: new Date(), lastStatus: "ok", lastError: null, lastDurationMs: 1 }));
const withStuck = (name: string) =>
  healthy().map((s) => (s.jobName === name ? { ...s, lastRunAt: new Date(Date.now() - 5 * HOUR_MS) } : s));

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
  mockPrisma.systemSetting.upsert.mockResolvedValue({});
  mockPrisma.systemSetting.delete.mockResolvedValue({});
  sendAdminAlertEmail.mockResolvedValue(undefined);
  countAbandonedInbound.mockResolvedValue(0);
  vi.spyOn(process, "uptime").mockReturnValue(24 * 3600);
});

describe("job watchdog", () => {
  it("stays quiet when everything is healthy, and clears any old marker", async () => {
    getJobStatuses.mockResolvedValue(healthy());
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ key: "job_watchdog_last_alert", value: JSON.stringify({ at: new Date().toISOString(), key: "reviews" }) });

    await runJobWatchdogJob();

    expect(sendAdminAlertEmail).not.toHaveBeenCalled();
    expect(mockPrisma.systemSetting.delete).toHaveBeenCalled();
  });

  it("alerts the hour a job goes stale — not the next morning", async () => {
    getJobStatuses.mockResolvedValue(withStuck("depositExpiry"));

    await runJobWatchdogJob();

    expect(sendAdminAlertEmail).toHaveBeenCalledOnce();
    expect(sendAdminAlertEmail.mock.calls[0][1]).toContain("depositExpiry");
    // Remembers what it alerted on, so the next hour is not a repeat.
    const stored = JSON.parse(mockPrisma.systemSetting.upsert.mock.calls[0][0].create.value);
    expect(stored.key).toBe("depositExpiry");
  });

  it("does not repeat the same incident every hour", async () => {
    getJobStatuses.mockResolvedValue(withStuck("depositExpiry"));
    mockPrisma.systemSetting.findUnique.mockResolvedValue({
      key: "job_watchdog_last_alert",
      value: JSON.stringify({ at: new Date(Date.now() - HOUR_MS).toISOString(), key: "depositExpiry" }),
    });

    await runJobWatchdogJob();

    expect(sendAdminAlertEmail).not.toHaveBeenCalled();
  });

  it("repeats after six hours if it is still true", async () => {
    getJobStatuses.mockResolvedValue(withStuck("depositExpiry"));
    mockPrisma.systemSetting.findUnique.mockResolvedValue({
      key: "job_watchdog_last_alert",
      value: JSON.stringify({ at: new Date(Date.now() - 7 * HOUR_MS).toISOString(), key: "depositExpiry" }),
    });

    await runJobWatchdogJob();

    expect(sendAdminAlertEmail).toHaveBeenCalledOnce();
  });

  it("alerts immediately when a second job joins an incident already reported", async () => {
    getJobStatuses.mockResolvedValue(withStuck("depositExpiry").map((s) => (s.jobName === "reviews" ? { ...s, lastStatus: "error", lastError: "x" } : s)));
    mockPrisma.systemSetting.findUnique.mockResolvedValue({
      key: "job_watchdog_last_alert",
      value: JSON.stringify({ at: new Date().toISOString(), key: "depositExpiry" }),
    });

    await runJobWatchdogJob();

    expect(sendAdminAlertEmail).toHaveBeenCalledOnce();
    expect(sendAdminAlertEmail.mock.calls[0][1]).toContain("reviews");
  });

  it("counts abandoned inbound messages as an incident of their own", async () => {
    getJobStatuses.mockResolvedValue(healthy());
    countAbandonedInbound.mockResolvedValue(3);

    await runJobWatchdogJob();

    expect(sendAdminAlertEmail).toHaveBeenCalledOnce();
    expect(sendAdminAlertEmail.mock.calls[0][1]).toContain("3 inbound WhatsApp message(s) abandoned");
  });
});
