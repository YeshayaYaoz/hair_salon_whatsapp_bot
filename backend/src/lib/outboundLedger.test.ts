import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  business: { findUnique: vi.fn() },
  whatsAppOutbound: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
};
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
const notifyOwner = vi.fn();
vi.mock("./ownerNotify.js", () => ({ notifyOwner: (...a: unknown[]) => notifyOwner(...a) }));

const { recordOutbound, recordOutboundStatuses, explainFailure, undeliveredBreakdown, __clearOutboundCache } =
  await import("./outboundLedger.js");

const event = (over: Record<string, unknown> = {}) => ({
  phoneNumberId: "pn-1", to: "972501111111", kind: "reminder", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  __clearOutboundCache();
  mockPrisma.business.findUnique.mockResolvedValue({ id: "b1" });
  mockPrisma.whatsAppOutbound.create.mockResolvedValue({});
  mockPrisma.whatsAppOutbound.update.mockResolvedValue({});
  notifyOwner.mockResolvedValue(true);
});

/**
 * A send returns 200 when Meta accepts the message. Whether it arrived comes later, on the status
 * webhook, and used to be discarded for everything but campaigns — a reminder to a closed window
 * reported "sent" everywhere and reached no one. These pin the two halves: every send recorded,
 * every status settled forward, and the owner told when something proactive did not land.
 */
describe("recordOutbound", () => {
  it("writes an accepted send with its message id, resolved to the business that owns the number", async () => {
    await recordOutbound(event({ messageId: "wamid.1", templateName: "reminder_he" }));
    const data = mockPrisma.whatsAppOutbound.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ messageId: "wamid.1", businessId: "b1", kind: "reminder", templateName: "reminder_he" });
    expect(data.status).toBeUndefined(); // the default, "sent" — the sender only ever knows "accepted"
  });

  it("writes a refused send as failed straight away, with Meta's code — there is no id to wait on", async () => {
    await recordOutbound(event({ refused: { status: 400, code: 131026, message: "Message Undeliverable" } }));
    const data = mockPrisma.whatsAppOutbound.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ messageId: null, status: "failed", failCode: 131026 });
  });

  it("looks the business up once per number, not once per message", async () => {
    await recordOutbound(event({ messageId: "wamid.1" }));
    await recordOutbound(event({ messageId: "wamid.2" }));
    expect(mockPrisma.business.findUnique).toHaveBeenCalledTimes(1);
  });

  it("never throws — a bookkeeping failure must not cost a customer their message", async () => {
    mockPrisma.whatsAppOutbound.create.mockRejectedValue(new Error("db down"));
    await expect(recordOutbound(event({ messageId: "wamid.1" }))).resolves.toBeUndefined();
  });
});

describe("recordOutboundStatuses", () => {
  const row = (over: Record<string, unknown> = {}) => ({ status: "sent", kind: "reminder", businessId: "b1", to: "972501111111", ...over });

  it("moves a row forward and stamps when", async () => {
    mockPrisma.whatsAppOutbound.findUnique.mockResolvedValue(row());
    await recordOutboundStatuses([{ id: "wamid.1", status: "delivered" }]);
    const data = mockPrisma.whatsAppOutbound.update.mock.calls[0][0].data;
    expect(data.status).toBe("delivered");
    expect(data.statusAt).toBeInstanceOf(Date);
  });

  it("does not let a late 'sent' overwrite 'delivered' — statuses arrive out of order", async () => {
    mockPrisma.whatsAppOutbound.findUnique.mockResolvedValue(row({ status: "delivered" }));
    await recordOutboundStatuses([{ id: "wamid.1", status: "sent" }]);
    expect(mockPrisma.whatsAppOutbound.update).not.toHaveBeenCalled();
  });

  it("ignores a message this ledger never saw", async () => {
    mockPrisma.whatsAppOutbound.findUnique.mockResolvedValue(null);
    await recordOutboundStatuses([{ id: "wamid.unknown", status: "failed" }]);
    expect(mockPrisma.whatsAppOutbound.update).not.toHaveBeenCalled();
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it("tells the owner, in their terms, when a proactive message fails", async () => {
    mockPrisma.whatsAppOutbound.findUnique.mockResolvedValue(row({ kind: "reminder" }));
    await recordOutboundStatuses([{ id: "wamid.1", status: "failed", errors: [{ code: 131047, title: "Re-engagement message" }] }]);
    expect(mockPrisma.whatsAppOutbound.update.mock.calls[0][0].data).toMatchObject({ status: "failed", failCode: 131047 });
    expect(notifyOwner).toHaveBeenCalledOnce();
    const [businessId, text] = notifyOwner.mock.calls[0] as [string, string];
    expect(businessId).toBe("b1");
    expect(text).toContain("התזכורת");
    expect(text).toContain("972501111111");
    expect(text).toContain("24 השעות"); // the explanation, not the code
  });

  it("does not bother the owner about a dropped chat reply — the customer will write again", async () => {
    mockPrisma.whatsAppOutbound.findUnique.mockResolvedValue(row({ kind: "text" }));
    await recordOutboundStatuses([{ id: "wamid.1", status: "failed", errors: [{ code: 131047 }] }]);
    expect(mockPrisma.whatsAppOutbound.update).toHaveBeenCalledOnce();
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it("tells the owner only once — a repeated 'failed' does not re-notify", async () => {
    mockPrisma.whatsAppOutbound.findUnique.mockResolvedValue(row({ status: "failed", kind: "reminder" }));
    await recordOutboundStatuses([{ id: "wamid.1", status: "failed", errors: [{ code: 131047 }] }]);
    expect(mockPrisma.whatsAppOutbound.update).not.toHaveBeenCalled();
    expect(notifyOwner).not.toHaveBeenCalled();
  });
});

describe("explainFailure", () => {
  it("translates the codes an owner will actually meet", () => {
    expect(explainFailure(131047)).toContain("24 השעות");
    expect(explainFailure(131026)).toContain("לא ניתן למסירה");
  });
  it("falls back to the code and Meta's title for anything else", () => {
    expect(explainFailure(999, "Something odd")).toBe("שגיאה 999 — Something odd");
    expect(explainFailure(null)).toBe("סיבה לא ידועה");
  });
});

describe("undeliveredBreakdown", () => {
  it("returns reasons most-common first, already explained", async () => {
    mockPrisma.whatsAppOutbound.groupBy.mockResolvedValue([
      { failCode: 131026, _count: { _all: 1 } },
      { failCode: 131047, _count: { _all: 4 } },
    ]);
    const out = await undeliveredBreakdown(86_400_000);
    expect(out[0].count).toBe(4);
    expect(out[0].reason).toContain("24 השעות");
    // Owner notices are not customer messages and are excluded from the count.
    expect(mockPrisma.whatsAppOutbound.groupBy.mock.calls[0][0].where.kind).toEqual({ not: "owner-notice" });
  });
});
