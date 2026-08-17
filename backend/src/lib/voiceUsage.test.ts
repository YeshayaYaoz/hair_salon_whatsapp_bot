import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./prisma.js", () => ({
  prisma: {
    business: { findMany: vi.fn() },
    apiUsageEvent: { create: vi.fn() },
  },
}));
vi.mock("./cartesiaAdmin.js", async () => {
  const actual = await vi.importActual<typeof import("./cartesiaAdmin.js")>("./cartesiaAdmin.js");
  return { ...actual, listAgentCalls: vi.fn() };
});

import { prisma } from "./prisma.js";
import { listAgentCalls } from "./cartesiaAdmin.js";
import { syncVoiceCallUsage, callCostAgorot, callDurationSeconds } from "./voiceUsage.js";

const mockCalls = listAgentCalls as unknown as ReturnType<typeof vi.fn>;
const findMany = prisma.business.findMany as unknown as ReturnType<typeof vi.fn>;
const create = prisma.apiUsageEvent.create as unknown as ReturnType<typeof vi.fn>;

function call(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "call_1",
    start_time: "2026-08-17T10:00:00Z",
    end_time: "2026-08-17T10:02:00Z",
    telephony_params: { to: "+972501111111", from: "+972502222222" },
    ...over,
  };
}

describe("callCostAgorot", () => {
  // Cartesia bills $0.06 for a minute, and a partial minute is a minute. Charging 90 seconds as
  // 1.5 minutes would put our figure permanently under the invoice.
  it("rounds a partial minute up, the way the provider bills it", () => {
    expect(callCostAgorot(60)).toBe(callCostAgorot(1));
    expect(callCostAgorot(61)).toBe(2 * callCostAgorot(60));
  });

  it("prices a minute at $0.06", () => {
    // 0.06 USD × 3.7 ILS × 100 = 22.2 agorot
    expect(callCostAgorot(60)).toBe(22);
  });
});

describe("callDurationSeconds", () => {
  it("is null while the call is still open, so an in-flight call is not recorded as zero", () => {
    expect(callDurationSeconds(call({ end_time: null }) as never)).toBeNull();
    expect(callDurationSeconds(call({ end_time: undefined }) as never)).toBeNull();
  });

  it("is the difference between the two timestamps", () => {
    expect(callDurationSeconds(call() as never)).toBe(120);
  });
});

describe("syncVoiceCallUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([{ id: "biz1", voicePhoneNumber: "0501111111" }]);
    create.mockResolvedValue({});
  });

  it("bills the call to the salon whose number was dialled, however the number was typed", async () => {
    // Stored as an owner types it, returned by Cartesia in E.164 — the same number.
    mockCalls.mockResolvedValue([call()]);
    const result = await syncVoiceCallUsage();
    expect(result.recorded).toBe(1);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: "biz1",
        kind: "voice_call",
        externalId: "call_1",
        durationSeconds: 120,
        costAgorot: callCostAgorot(120),
        customerPhone: "+972502222222",
      }),
    });
  });

  it("leaves an open call alone, since its duration is not knowable yet", async () => {
    mockCalls.mockResolvedValue([call({ end_time: null })]);
    const result = await syncVoiceCallUsage();
    expect(result.recorded).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("counts a call to an unclaimed number instead of dropping it — it still cost money", async () => {
    mockCalls.mockResolvedValue([call({ telephony_params: { to: "+972509999999", from: "+972502222222" } })]);
    const result = await syncVoiceCallUsage();
    expect(result).toMatchObject({ recorded: 0, unattributed: 1 });
  });

  // The window is re-read on every tick so that calls still open last time get their duration.
  // That re-read is only safe because a second write of the same call fails on the unique index.
  it("does not count a call twice when the window is re-read", async () => {
    mockCalls.mockResolvedValue([call()]);
    create.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    const result = await syncVoiceCallUsage();
    expect(result).toMatchObject({ recorded: 0, skipped: 1 });
  });

  it("still raises anything that is not a duplicate, rather than silently losing spend", async () => {
    mockCalls.mockResolvedValue([call()]);
    create.mockRejectedValueOnce(Object.assign(new Error("db down"), { code: "P1001" }));
    await expect(syncVoiceCallUsage()).rejects.toThrow("db down");
  });

  it("records a call with no caller id rather than dropping it", async () => {
    mockCalls.mockResolvedValue([call({ telephony_params: { to: "+972501111111", from: null } })]);
    await syncVoiceCallUsage();
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ customerPhone: "unknown" }) });
  });
});
