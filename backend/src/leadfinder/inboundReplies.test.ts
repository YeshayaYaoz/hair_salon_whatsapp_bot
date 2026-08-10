import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
const update = vi.fn();
const consentCreate = vi.fn();
const eventCreate = vi.fn();
const $transaction = vi.fn(async (ops: unknown[]) => ops);
const sendAdminAlertEmail = vi.fn();

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    lead: { findMany, update },
    consentLog: { create: consentCreate },
    leadStatusEvent: { create: eventCreate },
    $transaction,
  },
}));
vi.mock("../lib/email.js", () => ({ sendAdminAlertEmail }));

const { handleOutreachReply, classifyReply, phoneKey, isOutreachNumber } = await import("./inboundReplies.js");

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([{ id: "lead1", name: "מספרת דנה", phone: "04-123-4567", status: "contacted", campaignId: "c1" }]);
});

describe("classifyReply", () => {
  it("reads a bare yes as interest", () => {
    expect(classifyReply("כן, אני מעוניין")).toBe("interested");
    expect(classifyReply("מעוניינת")).toBe("interested");
  });

  it("reads a bare removal request as an opt-out", () => {
    expect(classifyReply("הסר")).toBe("opt_out");
    expect(classifyReply("לא מעוניין")).toBe("opt_out");
    expect(classifyReply("STOP")).toBe("opt_out");
  });

  it("does not read an opt-out out of a longer sentence that says yes", () => {
    // Substring matching would have caught "לא מעוניין" here and marked an interested lead as
    // removed — an error that costs the lead and is invisible afterwards.
    expect(classifyReply("אני כן מעוניין, לא מעוניין לשלם מראש")).toBe("other");
  });

  it("sends anything ambiguous to a human", () => {
    expect(classifyReply("כמה זה עולה אחרי החודש?")).toBe("other");
  });
});

describe("phoneKey", () => {
  it("matches Google's formatting against WhatsApp's bare digits", () => {
    expect(phoneKey("04-123-4567")).toBe(phoneKey("972041234567"));
    expect(phoneKey("+972 4-123-4567")).toBe(phoneKey("97241234567"));
  });
});

describe("isOutreachNumber", () => {
  it("is false when no outreach number is configured, so salon traffic is never captured", () => {
    delete process.env.TORI_OUTREACH_PHONE_NUMBER_ID;
    expect(isOutreachNumber("")).toBe(false);
    expect(isOutreachNumber("12345")).toBe(false);
  });

  it("matches only the configured number", () => {
    process.env.TORI_OUTREACH_PHONE_NUMBER_ID = "outreach-1";
    expect(isOutreachNumber("outreach-1")).toBe(true);
    expect(isOutreachNumber("salon-9")).toBe(false);
  });
});

describe("handleOutreachReply", () => {
  it("advances a matched lead to replied and alerts the operator", async () => {
    expect(await handleOutreachReply("972041234567", "כן, אני מעוניין")).toBe(true);
    expect($transaction).toHaveBeenCalled();
    expect(update.mock.calls[0][0]).toMatchObject({ where: { id: "lead1" }, data: { status: "replied" } });
    expect(sendAdminAlertEmail).toHaveBeenCalled();
  });

  it("logs consent withdrawal on an opt-out", async () => {
    await handleOutreachReply("972041234567", "הסר");
    expect(consentCreate).toHaveBeenCalledWith({
      data: { leadId: "lead1", event: "opted_out", channel: "whatsapp" },
    });
    expect(update.mock.calls[0][0].data.status).toBe("not_interested");
  });

  it("never walks a later funnel status backwards", async () => {
    // A lead already at meeting_scheduled replying "כן" must not be demoted to replied — the
    // operator's own progress outranks anything inferred from a message.
    findMany.mockResolvedValue([{ id: "lead1", name: "x", phone: "0412345678", status: "meeting_scheduled", campaignId: "c1" }]);
    await handleOutreachReply("972412345678", "כן");
    expect($transaction).not.toHaveBeenCalled();
    expect(sendAdminAlertEmail).toHaveBeenCalled();
  });

  it("still alerts when no lead matches the number", async () => {
    // Owners often reply from a mobile that isn't the listed business line; dropping those is the
    // exact failure this module exists to fix.
    findMany.mockResolvedValue([]);
    expect(await handleOutreachReply("972500000000", "מעניין, ספר לי עוד")).toBe(true);
    expect($transaction).not.toHaveBeenCalled();
    expect(sendAdminAlertEmail).toHaveBeenCalled();
    expect(sendAdminAlertEmail.mock.calls[0][1]).toMatch(/לא נמצא ליד/);
  });
});
