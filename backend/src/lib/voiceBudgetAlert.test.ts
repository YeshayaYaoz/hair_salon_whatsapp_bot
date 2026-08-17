import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./prisma.js", () => ({
  prisma: {
    apiUsageEvent: { findMany: vi.fn() },
    systemSetting: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));
vi.mock("./email.js", () => ({ sendAdminAlertEmail: vi.fn() }));

import { prisma } from "./prisma.js";
import { sendAdminAlertEmail } from "./email.js";
import { voiceBudgetStatus, runVoiceBudgetAlertJob } from "./voiceBudgetAlert.js";

const findMany = prisma.apiUsageEvent.findMany as unknown as ReturnType<typeof vi.fn>;
const findUnique = prisma.systemSetting.findUnique as unknown as ReturnType<typeof vi.fn>;
const upsert = prisma.systemSetting.upsert as unknown as ReturnType<typeof vi.fn>;
const sendMail = sendAdminAlertEmail as unknown as ReturnType<typeof vi.fn>;

/** n calls of `seconds` each. */
const calls = (n: number, seconds: number) => Array.from({ length: n }, () => ({ durationSeconds: seconds }));

describe("voiceBudgetStatus", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => delete process.env.CARTESIA_MONTHLY_PREPAID_USD);

  // The whole reason this exists is to fire before the invoice does, and the invoice rounds up.
  it("bills a partial minute as a whole one, per call", async () => {
    findMany.mockResolvedValue(calls(4, 61)); // 4 × 2 min, not 4 × 1.02
    const s = await voiceBudgetStatus();
    expect(s.billedMinutes).toBe(8);
    expect(s.spentUsd).toBeCloseTo(0.48, 5);
  });

  it("never sums the seconds first, which would read under the invoice", async () => {
    // Six 10-second calls are six billed minutes, not one.
    findMany.mockResolvedValue(calls(6, 10));
    expect((await voiceBudgetStatus()).billedMinutes).toBe(6);
  });

  it("defaults to the Pro plan's $5 and takes an override", async () => {
    findMany.mockResolvedValue(calls(1, 60));
    expect((await voiceBudgetStatus()).budgetUsd).toBe(5);
    process.env.CARTESIA_MONTHLY_PREPAID_USD = "49";
    expect((await voiceBudgetStatus()).budgetUsd).toBe(49);
  });

  it("ignores a malformed override rather than reporting an infinite budget", async () => {
    findMany.mockResolvedValue(calls(1, 60));
    process.env.CARTESIA_MONTHLY_PREPAID_USD = "not-a-number";
    expect((await voiceBudgetStatus()).budgetUsd).toBe(5);
  });
});

describe("runVoiceBudgetAlertJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(null);
    upsert.mockResolvedValue({});
  });

  it("says nothing below the first step", async () => {
    findMany.mockResolvedValue(calls(10, 60)); // $0.60 of $5 = 12%
    await runVoiceBudgetAlertJob();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("warns at 80%, while there is still a working phone line", async () => {
    findMany.mockResolvedValue(calls(70, 60)); // $4.20 = 84%
    await runVoiceBudgetAlertJob();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ value: "80" }) }));
  });

  it("does not repeat a step it already sent — an hourly job must not mail hourly", async () => {
    findMany.mockResolvedValue(calls(70, 60));
    findUnique.mockResolvedValue({ key: "k", value: "80" });
    await runVoiceBudgetAlertJob();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("still escalates to the 100% mail after the 80% one", async () => {
    findMany.mockResolvedValue(calls(90, 60)); // $5.40 = 108%
    findUnique.mockResolvedValue({ key: "k", value: "80" });
    await runVoiceBudgetAlertJob();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toContain("נגמר התקציב");
  });

  // A month that goes straight past both steps between two ticks should describe where things
  // stand, not send the "getting close" mail about a budget already spent.
  it("sends one mail for the highest step crossed, not one per step", async () => {
    findMany.mockResolvedValue(calls(200, 60)); // 240%
    await runVoiceBudgetAlertJob();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ value: "100" }) }));
  });

  it("stays quiet in a month with no calls at all", async () => {
    findMany.mockResolvedValue([]);
    await runVoiceBudgetAlertJob();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("keys the state by month, so a new month re-arms with nothing to reset", async () => {
    findMany.mockResolvedValue(calls(70, 60));
    await runVoiceBudgetAlertJob();
    const key = upsert.mock.calls[0][0].where.key as string;
    expect(key).toMatch(/^voice_budget_alert:\d{4}-\d{2}$/);
  });

  it("swallows a mail failure rather than taking down the hourly tick", async () => {
    findMany.mockResolvedValue(calls(70, 60));
    sendMail.mockRejectedValueOnce(new Error("resend down"));
    await expect(runVoiceBudgetAlertJob()).resolves.toBeUndefined();
  });
});
