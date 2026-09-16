import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ZadarmaNumber } from "./zadarmaAdmin.js";

const mockPrisma = { business: { findMany: vi.fn(), update: vi.fn() } };
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
const sendAdminAlertEmail = vi.fn();
vi.mock("./email.js", () => ({ sendAdminAlertEmail: (...a: unknown[]) => sendAdminAlertEmail(...a) }));
const carrier = { listNumbers: vi.fn(), getBalance: vi.fn(), setAutoprolongation: vi.fn(), prolongNumber: vi.fn() };
vi.mock("./zadarmaAdmin.js", async () => {
  const actual = await vi.importActual<typeof import("./zadarmaAdmin.js")>("./zadarmaAdmin.js");
  return {
    ...actual,
    listNumbers: (...a: unknown[]) => carrier.listNumbers(...a),
    getBalance: (...a: unknown[]) => carrier.getBalance(...a),
    setAutoprolongation: (...a: unknown[]) => carrier.setAutoprolongation(...a),
    prolongNumber: (...a: unknown[]) => carrier.prolongNumber(...a),
  };
});

const { planVoiceNumberRenewal, runVoiceNumberRenewalJob, RENEW_AHEAD_DAYS } = await import("./voiceNumberRenewal.js");

const NOW = new Date("2026-09-16T09:00:00Z");
const DAY = 86_400_000;
const inDays = (d: number) => new Date(NOW.getTime() + d * DAY);

const num = (over: Partial<ZadarmaNumber> = {}): ZadarmaNumber => ({
  number: "972559000001", type: "common", status: "on", stopDate: inDays(20),
  monthlyFee: 3, currency: "USD", autorenew: true, isOnTest: false, ...over,
});
const biz = (over: Record<string, unknown> = {}) => ({
  id: "b1", name: "מספרת רונית", voicePhoneNumber: "+972559000001",
  subscriptionStatus: "active", blockedAt: null, ...over,
});
const balance = (b: number) => ({ balance: b, currency: "USD" });

/**
 * A Zadarma number is a monthly rental that renews itself from the balance only while autorenew
 * is on. Nothing used to check either. These pin the per-line rules and the one shared balance.
 */
describe("planVoiceNumberRenewal", () => {
  it("leaves a paying, auto-renewing, well-funded line alone — and records what the carrier said", () => {
    const { actions, report } = planVoiceNumberRenewal([num()], [biz()], balance(50), NOW);
    expect(actions).toEqual([{ kind: "persist", businessId: "b1", stopDate: inDays(20), autorenew: true }]);
    expect(report.atRisk).toEqual([]);
    expect(report.shortfall).toBeNull();
  });

  it("switches autorenew on for a paying business that had it off", () => {
    const { actions, report } = planVoiceNumberRenewal([num({ autorenew: false })], [biz()], balance(50), NOW);
    expect(actions).toContainEqual({ kind: "autorenew", number: "972559000001", on: true, businessName: "מספרת רונית", stopDate: inDays(20) });
    expect(report.repaired).toEqual(["מספרת רונית 972559000001"]);
  });

  it("switches autorenew off for a cancelled business, so Tori stops paying at the stop date", () => {
    const { actions, report } = planVoiceNumberRenewal([num()], [biz({ subscriptionStatus: "canceled" })], balance(50), NOW);
    expect(actions).toContainEqual(expect.objectContaining({ kind: "autorenew", on: false }));
    expect(report.released[0]).toContain("lapses 2026-10-06");
  });

  it("also releases a blocked business's line", () => {
    const { actions } = planVoiceNumberRenewal([num()], [biz({ blockedAt: new Date() })], balance(50), NOW);
    expect(actions).toContainEqual(expect.objectContaining({ kind: "autorenew", on: false }));
  });

  it("does not touch a past_due business — late is not gone", () => {
    const { actions } = planVoiceNumberRenewal([num({ autorenew: false })], [biz({ subscriptionStatus: "past_due" })], balance(50), NOW);
    expect(actions.filter((a) => a.kind === "autorenew")).toEqual([]);
  });

  it("flags a paying line expiring within a week that the balance cannot cover", () => {
    const { report } = planVoiceNumberRenewal([num({ stopDate: inDays(3) })], [biz()], balance(1), NOW);
    expect(report.atRisk).toHaveLength(1);
    expect(report.atRisk[0]).toContain("cannot cover");
  });

  it("does not flag the same line when it is weeks away — tomorrow's run can still act", () => {
    const { report } = planVoiceNumberRenewal([num({ stopDate: inDays(RENEW_AHEAD_DAYS + 5) })], [biz()], balance(1), NOW);
    expect(report.atRisk).toEqual([]);
  });

  it("reports a balance that cannot cover everything due this month, with the first expiry", () => {
    const numbers = [
      num({ number: "972559000001", stopDate: inDays(10), monthlyFee: 3 }),
      num({ number: "972559000002", stopDate: inDays(25), monthlyFee: 3 }),
      num({ number: "972559000003", stopDate: inDays(60), monthlyFee: 3 }), // outside the window
    ];
    const businesses = [
      biz({ id: "b1", voicePhoneNumber: "972559000001" }),
      biz({ id: "b2", name: "צימר", voicePhoneNumber: "972559000002" }),
      biz({ id: "b3", name: "קליניקה", voicePhoneNumber: "972559000003" }),
    ];
    const { report } = planVoiceNumberRenewal(numbers, businesses, balance(5), NOW);
    expect(report.shortfall).toEqual({ balance: 5, due: 6, currency: "USD", firstExpiry: inDays(10) });
  });

  it("does not count a cancelled business's line against the balance", () => {
    const { report } = planVoiceNumberRenewal([num({ stopDate: inDays(5) })], [biz({ subscriptionStatus: "canceled" })], balance(0), NOW);
    expect(report.shortfall).toBeNull();
  });

  it("reports a line on the carrier account that no business owns", () => {
    const { report, actions } = planVoiceNumberRenewal([num({ number: "972559999999" })], [biz()], balance(50), NOW);
    expect(report.orphans[0]).toContain("972559999999");
    expect(actions.filter((a) => a.kind === "persist")).toEqual([]);
  });

  it("reports a paying business whose number the carrier no longer lists", () => {
    const { report } = planVoiceNumberRenewal([], [biz()], balance(50), NOW);
    expect(report.dead[0]).toContain("does not ring");
  });

  it("matches numbers by digits, whatever the formatting on either side", () => {
    const { report } = planVoiceNumberRenewal([num({ number: "+972 55-900-0001" })], [biz({ voicePhoneNumber: "972559000001" })], balance(50), NOW);
    expect(report.orphans).toEqual([]);
    expect(report.dead).toEqual([]);
  });
});

describe("runVoiceNumberRenewalJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.business.update.mockResolvedValue({});
    carrier.getBalance.mockResolvedValue(balance(50));
    carrier.setAutoprolongation.mockResolvedValue(undefined);
    sendAdminAlertEmail.mockResolvedValue(undefined);
  });

  it("does nothing, quietly, on a deployment with no carrier account", async () => {
    const { ZadarmaNotConfiguredError } = await import("./zadarmaAdmin.js");
    carrier.listNumbers.mockRejectedValue(new ZadarmaNotConfiguredError());
    await runVoiceNumberRenewalJob();
    expect(mockPrisma.business.findMany).not.toHaveBeenCalled();
    expect(sendAdminAlertEmail).not.toHaveBeenCalled();
  });

  it("persists the carrier's view on the business and sends no email when all is well", async () => {
    carrier.listNumbers.mockResolvedValue([num()]);
    mockPrisma.business.findMany.mockResolvedValue([biz()]);

    await runVoiceNumberRenewalJob();

    expect(mockPrisma.business.update.mock.calls[0][0].data).toEqual({ voiceNumberStopDate: inDays(20), voiceNumberAutorenew: true });
    expect(sendAdminAlertEmail).not.toHaveBeenCalled();
  });

  it("prepays a month when autorenew cannot be enabled and the line is days from lapsing", async () => {
    carrier.listNumbers.mockResolvedValue([num({ autorenew: false, stopDate: inDays(2) })]);
    mockPrisma.business.findMany.mockResolvedValue([biz()]);
    carrier.setAutoprolongation.mockRejectedValue(new Error("Zadarma /v1/direct_numbers/autoprolongation/ failed: not allowed"));
    carrier.prolongNumber.mockResolvedValue({ stopDate: inDays(32), totalPaid: 3, currency: "USD" });

    await runVoiceNumberRenewalJob();

    expect(carrier.prolongNumber).toHaveBeenCalledWith("972559000001", 1);
    expect(sendAdminAlertEmail).toHaveBeenCalledOnce();
    expect(sendAdminAlertEmail.mock.calls[0][1]).toContain("Prepaid a month");
  });

  it("does not prepay when the line is weeks away — reports and lets tomorrow retry", async () => {
    carrier.listNumbers.mockResolvedValue([num({ autorenew: false, stopDate: inDays(20) })]);
    mockPrisma.business.findMany.mockResolvedValue([biz()]);
    carrier.setAutoprolongation.mockRejectedValue(new Error("boom"));

    await runVoiceNumberRenewalJob();

    expect(carrier.prolongNumber).not.toHaveBeenCalled();
    expect(sendAdminAlertEmail.mock.calls[0][1]).toContain("could not enable autorenew");
  });

  it("emails the shortfall, which is the one that takes every line down at once", async () => {
    carrier.listNumbers.mockResolvedValue([num({ stopDate: inDays(5) })]);
    carrier.getBalance.mockResolvedValue(balance(0));
    mockPrisma.business.findMany.mockResolvedValue([biz()]);

    await runVoiceNumberRenewalJob();

    expect(sendAdminAlertEmail.mock.calls[0][0]).toContain("voice line problem");
    expect(sendAdminAlertEmail.mock.calls[0][1]).toContain("Balance cannot cover this month");
  });
});
