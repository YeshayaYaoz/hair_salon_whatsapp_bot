import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Who among the strangers on Tori's line gets the demo. The rules are few and each one guards a
 * real failure: an opt-out swallowed by a demo is a spam-law breach, a "מחר ב-10" mid-demo that
 * lands in the operator's inbox is a broken demo, and a plain reply to cold outreach that opens a
 * demo is a prospect being answered by a bot when they expected a person.
 */
const getHistory = vi.fn();
vi.mock("../bot/conversationStore.js", () => ({ getHistory: (...a: unknown[]) => getHistory(...a) }));
const mockPrisma = { $queryRaw: vi.fn(), $transaction: vi.fn(), lead: { update: vi.fn() }, leadStatusEvent: { create: vi.fn() } };
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
const sendAdminAlertEmail = vi.fn();
vi.mock("./email.js", () => ({ sendAdminAlertEmail: (...a: unknown[]) => sendAdminAlertEmail(...a), APP_URL: "https://app.test" }));

const { routeSharedStranger, isDemoTrigger, noteDemoStarted, demoFooter, siteUrl } = await import("./demoLine.js");

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TORI_DEMO_BUSINESS_ID = "demo-biz";
  getHistory.mockResolvedValue([]);
});

describe("routeSharedStranger", () => {
  it("sends 'דמו' to the demo, in either language and inside a sentence", async () => {
    expect(await routeSharedStranger("972501", "דמו")).toBe("demo");
    expect(await routeSharedStranger("972501", "Demo please")).toBe("demo");
    expect(await routeSharedStranger("972501", "היי, רוצה לראות את הדמו")).toBe("demo");
    expect(isDemoTrigger("שלום")).toBe(false);
  });

  it("keeps a live demo thread with the demo, whatever the next message says", async () => {
    getHistory.mockResolvedValue([{ role: "user", content: "דמו", at: new Date() }]);
    expect(await routeSharedStranger("972501", "מחר ב-10 מתאים")).toBe("demo");
    expect(getHistory).toHaveBeenCalledWith("demo-biz", "972501");
  });

  it("never lets a demo swallow an opt-out", async () => {
    getHistory.mockResolvedValue([{ role: "user", content: "דמו", at: new Date() }]);
    expect(await routeSharedStranger("972501", "הסר")).toBe("outreach");
    expect(await routeSharedStranger("972501", "לא מעוניין")).toBe("outreach");
  });

  it("leaves a plain reply to cold outreach with the lead finder", async () => {
    expect(await routeSharedStranger("972501", "כן, מעניין אותי")).toBe("outreach");
  });

  it("is off entirely without TORI_DEMO_BUSINESS_ID", async () => {
    delete process.env.TORI_DEMO_BUSINESS_ID;
    expect(await routeSharedStranger("972501", "דמו")).toBe("outreach");
    expect(getHistory).not.toHaveBeenCalled();
  });
});

describe("noteDemoStarted", () => {
  it("alerts the operator and moves a known lead to 'replied' with a timeline note", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ id: "lead1", name: "מספרת רונית", status: "contacted" }]);
    mockPrisma.$transaction.mockResolvedValue([]);

    await noteDemoStarted("972501234567", "דמו");

    expect(mockPrisma.lead.update).toHaveBeenCalledWith({ where: { id: "lead1" }, data: { status: "replied" } });
    expect(mockPrisma.leadStatusEvent.create.mock.calls[0][0].data).toMatchObject({ leadId: "lead1", toStatus: "replied" });
    expect(sendAdminAlertEmail.mock.calls[0][0]).toContain("מספרת רונית");
  });

  it("does not walk a converted lead backwards", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ id: "lead1", name: "x", status: "converted" }]);
    mockPrisma.$transaction.mockResolvedValue([]);
    await noteDemoStarted("972501234567", "דמו");
    expect(mockPrisma.lead.update).toHaveBeenCalledWith({ where: { id: "lead1" }, data: {} });
  });

  it("still alerts on an unknown number, and never throws", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    sendAdminAlertEmail.mockRejectedValue(new Error("mail down"));
    await expect(noteDemoStarted("972509999999", "demo")).resolves.toBeUndefined();
    expect(sendAdminAlertEmail.mock.calls[0][0]).toContain("972509999999");
  });
});

describe("demoFooter", () => {
  it("names the product and the site, in the reader's language", () => {
    process.env.APP_URL = "https://app.torionline.com/";
    expect(demoFooter("he")).toContain("תורי");
    expect(demoFooter("he")).toContain("https://app.torionline.com");
    expect(demoFooter("en")).toContain("Tori");
  });

  it("never sends a prospect to localhost", () => {
    process.env.APP_URL = "http://localhost:3000";
    expect(siteUrl()).toBe("https://torionline.com");
    delete process.env.APP_URL;
    expect(siteUrl()).toBe("https://torionline.com");
  });
});
