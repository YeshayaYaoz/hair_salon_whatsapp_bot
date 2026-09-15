import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  whatsAppInbound: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
};
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/errorMonitoring.js", () => ({ captureError: vi.fn() }));

const { inboundIdentity, recordInbound, runInboundRecoveryJob } = await import("./whatsappInbox.js");

/** A real inbound text message, shaped the way Meta actually sends it. */
const messagePayload = (wamid = "wamid.ABC") => ({
  entry: [{ changes: [{ value: {
    metadata: { phone_number_id: "pn-1" },
    messages: [{ id: wamid, from: "972500000000", type: "text", text: { body: "היי" } }],
  } }] }],
});

/** A delivery-status callback: same webhook, no user message. */
const statusPayload = () => ({
  entry: [{ changes: [{ value: {
    metadata: { phone_number_id: "pn-1" },
    statuses: [{ id: "wamid.OUT", status: "delivered" }],
  } }] }],
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.whatsAppInbound.update.mockResolvedValue({});
});

describe("inboundIdentity", () => {
  it("reads the wamid and phone number off a user message", () => {
    expect(inboundIdentity(messagePayload("wamid.X"))).toEqual({ wamid: "wamid.X", phoneNumberId: "pn-1" });
  });

  it("returns null for a delivery status — those are not deduplicated or recovered", () => {
    expect(inboundIdentity(statusPayload())).toBeNull();
  });

  it("returns null rather than throwing on garbage", () => {
    expect(inboundIdentity(null)).toBeNull();
    expect(inboundIdentity({})).toBeNull();
    expect(inboundIdentity({ entry: [{ changes: [{ value: { messages: [{}] } }] }] })).toBeNull();
  });
});

/**
 * The webhook used to deduplicate in a Map that a redeploy emptied and two instances never
 * shared. The unique index on wamid is the replacement; these pin down how its three outcomes
 * are surfaced, because the route makes a different HTTP decision on each.
 */
describe("recordInbound", () => {
  const identity = { wamid: "wamid.ABC", phoneNumberId: "pn-1" };

  it("writes the row with the first attempt already claimed by the live handler", async () => {
    mockPrisma.whatsAppInbound.create.mockResolvedValue({});
    expect(await recordInbound(identity, messagePayload())).toBe("new");
    const data = mockPrisma.whatsAppInbound.create.mock.calls[0][0].data;
    expect(data.wamid).toBe("wamid.ABC");
    expect(data.attempts).toBe(1);
    expect(data.startedAt).toBeInstanceOf(Date);
  });

  it("reports a duplicate when the unique index rejects the wamid", async () => {
    mockPrisma.whatsAppInbound.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    expect(await recordInbound(identity, messagePayload())).toBe("duplicate");
  });

  it("reports unavailable on any other database failure — so the route can refuse the delivery", async () => {
    mockPrisma.whatsAppInbound.create.mockRejectedValue(new Error("connection refused"));
    expect(await recordInbound(identity, messagePayload())).toBe("unavailable");
  });
});

/**
 * A crash between the 200 and the reply used to lose the message for good. The sweep is what
 * turns that into a late reply — but only if it takes rows a dead worker left, never rows a slow
 * worker is still on, and never the same row twice across two instances.
 */
describe("runInboundRecoveryJob", () => {
  const staleRow = { id: "r1", wamid: "wamid.OLD", payload: messagePayload("wamid.OLD"), attempts: 1 };

  it("asks only for rows that are unprocessed, under the attempt cap, and stale", async () => {
    mockPrisma.whatsAppInbound.findMany.mockResolvedValue([]);
    await runInboundRecoveryJob(vi.fn());
    const where = mockPrisma.whatsAppInbound.findMany.mock.calls[0][0].where;
    expect(where.processedAt).toBeNull();
    expect(where.attempts).toEqual({ lt: 2 });
    // Fresh rows belong to a handler that is still running; only a stale startedAt qualifies.
    expect(where.OR).toEqual([{ startedAt: null }, { startedAt: { lt: expect.any(Date) } }]);
  });

  it("claims, reprocesses and marks the row", async () => {
    mockPrisma.whatsAppInbound.findMany.mockResolvedValue([staleRow]);
    mockPrisma.whatsAppInbound.updateMany.mockResolvedValue({ count: 1 });
    const process = vi.fn().mockResolvedValue(undefined);

    await runInboundRecoveryJob(process);

    expect(process).toHaveBeenCalledWith(staleRow.payload);
    // The claim is conditional on the attempt count it read — that is the race guard.
    expect(mockPrisma.whatsAppInbound.updateMany.mock.calls[0][0].where).toEqual({ id: "r1", attempts: 1, processedAt: null });
    expect(mockPrisma.whatsAppInbound.update.mock.calls.at(-1)![0].data.processedAt).toBeInstanceOf(Date);
  });

  it("does nothing with a row another instance claimed first", async () => {
    mockPrisma.whatsAppInbound.findMany.mockResolvedValue([staleRow]);
    mockPrisma.whatsAppInbound.updateMany.mockResolvedValue({ count: 0 });
    const process = vi.fn();

    await runInboundRecoveryJob(process);

    expect(process).not.toHaveBeenCalled();
  });

  it("records the error and leaves the row unprocessed when reprocessing throws", async () => {
    mockPrisma.whatsAppInbound.findMany.mockResolvedValue([staleRow]);
    mockPrisma.whatsAppInbound.updateMany.mockResolvedValue({ count: 1 });
    const process = vi.fn().mockRejectedValue(new Error("model down"));

    await runInboundRecoveryJob(process);

    const updates = mockPrisma.whatsAppInbound.update.mock.calls.map((c) => c[0].data);
    expect(updates.some((d) => d.lastError === "model down")).toBe(true);
    expect(updates.some((d) => d.processedAt)).toBe(false);
  });
});
