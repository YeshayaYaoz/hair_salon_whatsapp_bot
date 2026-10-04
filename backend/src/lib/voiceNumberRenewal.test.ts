import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ZadarmaNumber } from "./zadarmaAdmin.js";

const mockPrisma = { business: { findMany: vi.fn(), update: vi.fn() } };
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
const sendAdminAlertEmail = vi.fn();
vi.mock("./email.js", () => ({ sendAdminAlertEmail: (...a: unknown[]) => sendAdminAlertEmail(...a) }));
const notifyOwner = vi.fn();
vi.mock("./ownerNotify.js", () => ({ notifyOwner: (...a: unknown[]) => notifyOwner(...a) }));
const carrier = { listNumbers: vi.fn(), getBalance: vi.fn(), setAutoprolongation: vi.fn(), prolongNumber: vi.fn(), setSmsReception: vi.fn() };
vi.mock("./zadarmaAdmin.js", async () => {
  const actual = await vi.importActual<typeof import("./zadarmaAdmin.js")>("./zadarmaAdmin.js");
  return {
    ...actual,
    listNumbers: (...a: unknown[]) => carrier.listNumbers(...a),
    getBalance: (...a: unknown[]) => carrier.getBalance(...a),
    setAutoprolongation: (...a: unknown[]) => carrier.setAutoprolongation(...a),
    prolongNumber: (...a: unknown[]) => carrier.prolongNumber(...a),
    setSmsReception: (...a: unknown[]) => carrier.setSmsReception(...a),
  };
});

const { planVoiceNumberRenewal, runVoiceNumberRenewalJob, RENEW_AHEAD_DAYS } = await import("./voiceNumberRenewal.js");
const { NUMBER_GRACE_DAYS } = await import("./numberGrace.js");

const NOW = new Date("2026-09-16T09:00:00Z");
const DAY = 86_400_000;
const inDays = (d: number) => new Date(NOW.getTime() + d * DAY);

const num = (over: Partial<ZadarmaNumber> = {}): ZadarmaNumber => ({
  number: "972559000001", type: "common", status: "on", stopDate: inDays(20),
  monthlyFee: 3, currency: "USD", autorenew: true, isOnTest: false, ...over,
});
const biz = (over: Record<string, unknown> = {}) => ({
  id: "b1", name: "מספרת רונית", voicePhoneNumber: "+972559000001", voiceNumberOrderedAt: inDays(-200),
  subscriptionStatus: "active", subscriptionLapsedAt: null, blockedAt: null, ...over,
});
/** Stopped paying `daysAgo` days ago — past_due is what the dunning ladder ends in. */
const lapsed = (daysAgo: number, over: Record<string, unknown> = {}) =>
  biz({ subscriptionStatus: "past_due", subscriptionLapsedAt: inDays(-daysAgo), ...over });
const balance = (b: number) => ({ balance: b, currency: "USD" });
const autorenewActions = (actions: { kind: string }[]) => actions.filter((a) => a.kind === "autorenew");

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

  /**
   * The month in the middle. The number is the business's whole line, and a salon sorting out a
   * declined card must find it where it was. So a lapsed line is paid for like a live one for
   * NUMBER_GRACE_DAYS, and released on the day after.
   */
  describe("a business that stopped paying", () => {
    it("keeps the line for a month — autorenew on, counted against the balance, nothing released", () => {
      const { actions, report } = planVoiceNumberRenewal([num({ autorenew: false, stopDate: inDays(5) })], [lapsed(10)], balance(0), NOW);
      expect(actions).toContainEqual(expect.objectContaining({ kind: "autorenew", on: true }));
      expect(report.released).toEqual([]);
      expect(report.held[0]).toContain(`held until ${inDays(NUMBER_GRACE_DAYS - 10).toISOString().slice(0, 10)}`);
      expect(report.shortfall).toMatchObject({ due: 3 }); // Tori pays for a held line, so it is budgeted
    });

    it("releases the line once the month is up, and tells the owner once — on the flip", () => {
      const { actions, report } = planVoiceNumberRenewal([num()], [lapsed(NUMBER_GRACE_DAYS + 1)], balance(50), NOW);
      expect(actions).toContainEqual(expect.objectContaining({ kind: "autorenew", on: false }));
      expect(actions).toContainEqual({ kind: "release-notice", businessId: "b1", number: "972559000001", stopDate: inDays(20) });
      expect(report.released[0]).toContain("lapses 2026-10-06");
      expect(report.held).toEqual([]);
    });

    it("does not notify again on later days — autorenew is already off", () => {
      const { actions } = planVoiceNumberRenewal([num({ autorenew: false })], [lapsed(NUMBER_GRACE_DAYS + 5)], balance(50), NOW);
      expect(actions.filter((a) => a.kind !== "persist")).toEqual([]);
    });

    it("holds right up to the last day of the month and releases the day after", () => {
      const lastDay = planVoiceNumberRenewal([num()], [lapsed(NUMBER_GRACE_DAYS - 0.5)], balance(50), NOW);
      expect(lastDay.report.held).toHaveLength(1);
      const dayAfter = planVoiceNumberRenewal([num()], [lapsed(NUMBER_GRACE_DAYS)], balance(50), NOW);
      expect(dayAfter.report.released).toHaveLength(1);
    });

    it("treats canceled and blocked the same as past_due", () => {
      const canceled = planVoiceNumberRenewal([num()], [biz({ subscriptionStatus: "canceled", subscriptionLapsedAt: inDays(-40) })], balance(50), NOW);
      expect(canceled.report.released).toHaveLength(1);
      const blocked = planVoiceNumberRenewal([num()], [biz({ blockedAt: inDays(-40) })], balance(50), NOW);
      expect(blocked.report.released).toHaveLength(1);
      const blockedRecently = planVoiceNumberRenewal([num()], [biz({ blockedAt: inDays(-3) })], balance(50), NOW);
      expect(blockedRecently.report.held).toHaveLength(1);
    });

    it("counts from the earlier of the lapse and the block", () => {
      const { report } = planVoiceNumberRenewal([num()], [lapsed(3, { blockedAt: inDays(-45) })], balance(50), NOW);
      expect(report.released).toHaveLength(1);
    });

    it("starts the clock today for a lapsed business nothing stamped, so the month always begins somewhere", () => {
      const { actions, report } = planVoiceNumberRenewal([num()], [biz({ subscriptionStatus: "canceled" })], balance(50), NOW);
      expect(actions).toContainEqual({ kind: "stamp", businessId: "b1", lapsedAt: NOW });
      expect(report.held).toHaveLength(1);
      expect(report.released).toEqual([]);
    });

    it("takes a released number off the business once the carrier no longer lists it — but only one Tori bought", () => {
      const ours = planVoiceNumberRenewal([], [lapsed(60)], balance(50), NOW);
      expect(ours.actions).toContainEqual({ kind: "detach", businessId: "b1", businessName: "מספרת רונית", number: "+972559000001" });
      expect(ours.report.dead).toEqual([]);
      const theirs = planVoiceNumberRenewal([], [lapsed(60, { voiceNumberOrderedAt: null })], balance(50), NOW);
      expect(theirs.actions).toEqual([]);
    });
  });

  it("buys back a parked line for a business that is paying again", () => {
    const { actions, report } = planVoiceNumberRenewal([num({ status: "parking", autorenew: false })], [biz()], balance(50), NOW);
    expect(actions).toContainEqual({ kind: "restore", number: "972559000001", businessId: "b1", businessName: "מספרת רונית" });
    expect(actions).toContainEqual(expect.objectContaining({ kind: "autorenew", on: true }));
    expect(report.restored).toEqual(["מספרת רונית 972559000001"]);
  });

  it("leaves a trial alone — a trial with a number is the operator's decision", () => {
    const { actions } = planVoiceNumberRenewal([num({ autorenew: false })], [biz({ subscriptionStatus: "trial" })], balance(50), NOW);
    expect(autorenewActions(actions)).toEqual([]);
  });

  /**
   * Buying three months at once — Zadarma's package, priced below three renewals and the thing
   * that unlocks SMS. Every paying line moves onto it as it comes up, and no purchase may leave
   * the balance unable to renew another salon's line.
   */
  describe("buying several months at once", () => {
    const prepayActions = (actions: { kind: string }[]) => actions.filter((a) => a.kind === "prepay");

    it("buys a paying line that is inside the renewal window, not one weeks away", () => {
      const soon = planVoiceNumberRenewal([num({ stopDate: inDays(5) })], [biz()], balance(50), NOW, 3);
      expect(prepayActions(soon.actions)).toEqual([{ kind: "prepay", number: "972559000001", businessId: "b1", businessName: "מספרת רונית", months: 3, monthlyFee: 3 }]);
      const later = planVoiceNumberRenewal([num({ stopDate: inDays(20) })], [biz()], balance(50), NOW, 3);
      expect(prepayActions(later.actions)).toEqual([]);
    });

    it("buys nothing ahead for a business that stopped paying, and nothing at all when turned off", () => {
      const held = planVoiceNumberRenewal([num({ stopDate: inDays(5) })], [lapsed(3)], balance(50), NOW, 3);
      expect(prepayActions(held.actions)).toEqual([]);
      const off = planVoiceNumberRenewal([num({ stopDate: inDays(5) })], [biz()], balance(50), NOW, 1);
      expect(prepayActions(off.actions)).toEqual([]);
    });

    it("never buys ahead what would leave another line unable to renew — and says what the balance must keep", () => {
      const numbers = [num({ number: "972559000001", stopDate: inDays(3) }), num({ number: "972559000002", stopDate: inDays(10) })];
      const businesses = [biz({ id: "b1", voicePhoneNumber: "972559000001" }), biz({ id: "b2", name: "צימר", voicePhoneNumber: "972559000002" })];
      // 9 on the balance: three months of line 1 is up to 9, and line 2 still needs 3 this month.
      const tight = planVoiceNumberRenewal(numbers, businesses, balance(9), NOW, 3);
      expect(prepayActions(tight.actions)).toEqual([]);
      expect(tight.report.prepaySkipped[0]).toContain("must keep 3");
      expect(tight.report.shortfall).toBeNull(); // monthly renewals are still covered
      // 12 is enough: 12 − 9 = 3 left for line 2.
      const enough = planVoiceNumberRenewal(numbers, businesses, balance(12), NOW, 3);
      expect(prepayActions(enough.actions)).toHaveLength(1);
    });

    it("buys every eligible line, earliest expiry first", () => {
      const numbers = [num({ number: "972559000002", stopDate: inDays(6) }), num({ number: "972559000001", stopDate: inDays(2) })];
      const businesses = [biz({ id: "b1", voicePhoneNumber: "972559000001" }), biz({ id: "b2", name: "צימר", voicePhoneNumber: "972559000002" })];
      const all = planVoiceNumberRenewal(numbers, businesses, balance(100), NOW, 3);
      expect(prepayActions(all.actions).map((a) => (a as { number: string }).number)).toEqual(["972559000001", "972559000002"]);
    });

    it("spends the balance on paper as it goes, so two purchases cannot both count the same money", () => {
      const numbers = [num({ number: "972559000001", stopDate: inDays(2) }), num({ number: "972559000002", stopDate: inDays(3) })];
      const businesses = [biz({ id: "b1", voicePhoneNumber: "972559000001" }), biz({ id: "b2", name: "צימר", voicePhoneNumber: "972559000002" })];
      // 15: line 1 takes up to 9, leaving 6 — line 2's 9 would leave −3, so it waits for monthly autorenew.
      const { actions, report } = planVoiceNumberRenewal(numbers, businesses, balance(15), NOW, 3);
      expect(prepayActions(actions)).toHaveLength(1);
      expect(report.prepaySkipped).toHaveLength(1);
    });
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

  it("does not count a released business's line against the balance", () => {
    const { report } = planVoiceNumberRenewal([num({ stopDate: inDays(5) })], [lapsed(60)], balance(0), NOW);
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
    carrier.setSmsReception.mockResolvedValue(undefined);
    sendAdminAlertEmail.mockResolvedValue(undefined);
  });

  const fromNow = (d: number) => new Date(Date.now() + d * DAY);

  it("buys three months for a line in its renewal window, switches SMS on behind it, and reports the real price", async () => {
    carrier.listNumbers.mockResolvedValue([num({ stopDate: fromNow(3) })]);
    mockPrisma.business.findMany.mockResolvedValue([biz()]);
    const until = fromNow(93);
    carrier.prolongNumber.mockResolvedValue({ stopDate: until, totalPaid: 6, currency: "USD" });

    await runVoiceNumberRenewalJob();

    expect(carrier.prolongNumber).toHaveBeenCalledWith("972559000001", 3);
    expect(carrier.setSmsReception).toHaveBeenCalledWith("972559000001", true);
    expect(sendAdminAlertEmail.mock.calls[0][1]).toContain("paid 6 USD for 3 months (2.00/month vs 3 monthly)");
    // The new stop date lands on the row the same day, not tomorrow.
    expect(mockPrisma.business.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { voiceNumberStopDate: until } });
  });

  it("an SMS refusal is a note for the operator, not a problem with the line", async () => {
    carrier.listNumbers.mockResolvedValue([num({ stopDate: fromNow(3) })]);
    mockPrisma.business.findMany.mockResolvedValue([biz()]);
    carrier.prolongNumber.mockResolvedValue({ stopDate: fromNow(93), totalPaid: 6, currency: "USD" });
    carrier.setSmsReception.mockRejectedValue(new Error("documents required"));

    await runVoiceNumberRenewalJob();

    expect(sendAdminAlertEmail.mock.calls[0][0]).not.toContain("problem");
    expect(sendAdminAlertEmail.mock.calls[0][1]).toContain("SMS reception refused");
    expect(sendAdminAlertEmail.mock.calls[0][1]).toContain("documents required");
  });

  it("a refused multi-month purchase is reported and leaves monthly autorenew standing", async () => {
    carrier.listNumbers.mockResolvedValue([num({ stopDate: fromNow(3) })]);
    mockPrisma.business.findMany.mockResolvedValue([biz()]);
    carrier.prolongNumber.mockRejectedValue(new Error("not enough funds"));

    await runVoiceNumberRenewalJob();
    expect(carrier.setSmsReception).not.toHaveBeenCalled();
    expect(sendAdminAlertEmail).not.toHaveBeenCalled(); // nothing is at risk: the line still renews monthly
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

  // The job's own "days left" is measured from the real clock, so these two use it too — a fixed
  // date drifted into the prepay window as the calendar moved and the test flipped on its own.

  it("prepays a month when autorenew cannot be enabled and the line is days from lapsing", async () => {
    carrier.listNumbers.mockResolvedValue([num({ autorenew: false, stopDate: fromNow(2) })]);
    mockPrisma.business.findMany.mockResolvedValue([biz()]);
    carrier.setAutoprolongation.mockRejectedValue(new Error("Zadarma /v1/direct_numbers/autoprolongation/ failed: not allowed"));
    carrier.prolongNumber.mockResolvedValue({ stopDate: fromNow(32), totalPaid: 3, currency: "USD" });

    await runVoiceNumberRenewalJob();

    expect(carrier.prolongNumber).toHaveBeenCalledWith("972559000001", 1);
    expect(sendAdminAlertEmail).toHaveBeenCalledOnce();
    expect(sendAdminAlertEmail.mock.calls[0][1]).toContain("Prepaid a month");
  });

  it("does not prepay when the line is weeks away — reports and lets tomorrow retry", async () => {
    carrier.listNumbers.mockResolvedValue([num({ autorenew: false, stopDate: fromNow(20) })]);
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

  it("on release: switches autorenew off and tells the owner the date the line stops, in Hebrew", async () => {
    carrier.listNumbers.mockResolvedValue([num()]);
    mockPrisma.business.findMany.mockResolvedValue([lapsed(45)]);
    notifyOwner.mockResolvedValue(true);

    await runVoiceNumberRenewalJob();

    expect(carrier.setAutoprolongation).toHaveBeenCalledWith("972559000001", false);
    expect(notifyOwner).toHaveBeenCalledOnce();
    const [businessId, text] = notifyOwner.mock.calls[0] as [string, string];
    expect(businessId).toBe("b1");
    expect(text).toContain("972559000001");
    expect(text).toContain("משתחרר");
    expect(text).toContain("חידוש לפני כן");
    expect(sendAdminAlertEmail.mock.calls[0][1]).toContain("hold over");
  });

  it("detaches a number the carrier dropped, clearing the order marker so a return can buy a fresh one", async () => {
    carrier.listNumbers.mockResolvedValue([]);
    mockPrisma.business.findMany.mockResolvedValue([lapsed(60)]);

    await runVoiceNumberRenewalJob();

    expect(mockPrisma.business.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { voicePhoneNumber: null, voiceNumberOrderedAt: null, voiceNumberStopDate: null, voiceNumberAutorenew: null },
    });
    expect(sendAdminAlertEmail.mock.calls[0][1]).toContain("taken off their businesses");
  });

  it("buys back a parked line when the business is paying again, and reports it if the carrier refuses", async () => {
    carrier.listNumbers.mockResolvedValue([num({ status: "parking" })]);
    mockPrisma.business.findMany.mockResolvedValue([biz()]);
    carrier.prolongNumber.mockResolvedValue({ stopDate: inDays(30), totalPaid: 3, currency: "USD" });

    await runVoiceNumberRenewalJob();
    expect(carrier.prolongNumber).toHaveBeenCalledWith("972559000001", 1);
    expect(sendAdminAlertEmail.mock.calls[0][1]).toContain("bought back");

    vi.clearAllMocks();
    carrier.listNumbers.mockResolvedValue([num({ status: "parking" })]);
    mockPrisma.business.findMany.mockResolvedValue([biz()]);
    carrier.prolongNumber.mockRejectedValue(new Error("not enough funds"));
    await runVoiceNumberRenewalJob();
    expect(sendAdminAlertEmail.mock.calls[0][0]).toContain("voice line problem");
    expect(sendAdminAlertEmail.mock.calls[0][1]).toContain("could not be bought back");
  });

  it("stamps today's date on a lapsed business that had none", async () => {
    carrier.listNumbers.mockResolvedValue([num()]);
    mockPrisma.business.findMany.mockResolvedValue([biz({ subscriptionStatus: "canceled" })]);

    await runVoiceNumberRenewalJob();

    const stamp = mockPrisma.business.update.mock.calls.find((c) => c[0].data.subscriptionLapsedAt);
    expect(stamp?.[0].data.subscriptionLapsedAt).toBeInstanceOf(Date);
    expect(carrier.setAutoprolongation).not.toHaveBeenCalled(); // held, and autorenew was already on
  });
});
