import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What makes the demo different from any other business on the shared line: the trigger word,
 * the operator alert, and the footer. The routing itself is sharedLineRouting.test.ts.
 */
const mockPrisma = { $queryRaw: vi.fn(), $transaction: vi.fn(), lead: { update: vi.fn() }, leadStatusEvent: { create: vi.fn() } };
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
const sendAdminAlertEmail = vi.fn();
vi.mock("./email.js", () => ({ sendAdminAlertEmail: (...a: unknown[]) => sendAdminAlertEmail(...a), APP_URL: "https://app.test" }));

const { isDemoTrigger, noteDemoStarted, demoFooter, siteUrl } = await import("./demoLine.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isDemoTrigger", () => {
  it("matches 'דמו' in either language and inside a sentence", () => {
    expect(isDemoTrigger("דמו")).toBe(true);
    expect(isDemoTrigger("Demo please")).toBe(true);
    expect(isDemoTrigger("היי, רוצה לראות את הדמו")).toBe(true);
    expect(isDemoTrigger("שלום")).toBe(false);
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
