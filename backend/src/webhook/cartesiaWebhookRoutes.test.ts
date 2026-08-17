import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("../lib/prisma.js", () => ({
  prisma: { apiUsageEvent: { updateMany: vi.fn(), create: vi.fn() }, business: { findMany: vi.fn() } },
}));
vi.mock("../lib/cartesiaAdmin.js", () => ({ getAgentCall: vi.fn() }));
vi.mock("../lib/voiceUsage.js", () => ({
  recordCall: vi.fn(),
  voiceNumberIndex: vi.fn(),
  transcriptMetrics: vi.fn(),
}));

import { prisma } from "../lib/prisma.js";
import { getAgentCall } from "../lib/cartesiaAdmin.js";
import { recordCall, voiceNumberIndex } from "../lib/voiceUsage.js";
import { cartesiaWebhookRouter } from "./cartesiaWebhookRoutes.js";

const updateMany = prisma.apiUsageEvent.updateMany as unknown as ReturnType<typeof vi.fn>;
const record = recordCall as unknown as ReturnType<typeof vi.fn>;
const index = voiceNumberIndex as unknown as ReturnType<typeof vi.fn>;
const fetchCall = getAgentCall as unknown as ReturnType<typeof vi.fn>;

const app = express();
app.use(express.json());
app.use("/api/cartesia", cartesiaWebhookRouter);

const CALL = {
  id: "ac_1",
  start_time: "2026-08-17T10:00:00Z",
  end_time: "2026-08-17T10:02:00Z",
  telephony_params: { to: "+972501111111", from: "+972502222222" },
};

/** The handler answers before it works, so the assertions need the microtasks to drain. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("POST /api/cartesia/call", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CARTESIA_WEBHOOK_SECRET = "hook-secret";
    index.mockResolvedValue(new Map([["972501111111", "biz1"]]));
    record.mockResolvedValue("recorded");
    updateMany.mockResolvedValue({ count: 1 });
  });
  afterEach(() => delete process.env.CARTESIA_WEBHOOK_SECRET);

  const post = (body: unknown, secret?: string) => {
    const r = request(app).post("/api/cartesia/call");
    if (secret !== undefined) r.set("x-webhook-secret", secret);
    return r.send(body as object);
  };

  it("rejects a delivery with no secret, and touches nothing", async () => {
    expect((await post({ type: "call_completed", call: CALL })).status).toBe(401);
    await settle();
    expect(record).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret", async () => {
    expect((await post({ type: "call_completed", call: CALL }, "wrong")).status).toBe(401);
    await settle();
    expect(record).not.toHaveBeenCalled();
  });

  // The secret is the entire proof of origin — Cartesia sends no signature — so an unset secret
  // must fail closed rather than accept everything.
  it("rejects everything when no secret is configured at all", async () => {
    delete process.env.CARTESIA_WEBHOOK_SECRET;
    expect((await post({ type: "call_completed", call: CALL }, "anything")).status).toBe(401);
  });

  it("records a completed call", async () => {
    const res = await post({ type: "call_completed", call: CALL }, "hook-secret");
    expect(res.status).toBe(200);
    await settle();
    expect(record).toHaveBeenCalledWith(CALL, expect.any(Map));
  });

  // A failed call still occupied a line and still billed.
  it("records a failed call too", async () => {
    await post({ type: "call_failed", call: { ...CALL, status: "failed" } }, "hook-secret");
    await settle();
    expect(record).toHaveBeenCalled();
  });

  it("attaches a summary to the call it belongs to", async () => {
    await post({ type: "post_call_analysis", call_id: "ac_1", analysis: { summary: "ביקש תמונות" } }, "hook-secret");
    await settle();
    expect(updateMany).toHaveBeenCalledWith({ where: { externalId: "ac_1" }, data: { summary: "ביקש תמונות" } });
    expect(fetchCall).not.toHaveBeenCalled();
  });

  // The two events are separate deliveries and nothing orders them. Dropping the summary because
  // its call has not landed yet would lose it for good — the sync never learns a summary existed.
  it("fetches the call when the analysis arrives first", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    fetchCall.mockResolvedValue(CALL);
    await post({ type: "post_call_analysis", call_id: "ac_1", analysis: { summary: "רצה לבטל" } }, "hook-secret");
    await settle();
    expect(fetchCall).toHaveBeenCalledWith("ac_1");
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ id: "ac_1", summary: "רצה לבטל" }), expect.any(Map));
  });

  it("ignores an analysis with no summary in it", async () => {
    await post({ type: "post_call_analysis", call_id: "ac_1", analysis: {} }, "hook-secret");
    await settle();
    expect(updateMany).not.toHaveBeenCalled();
  });

  // Every turn arrives again inside call_completed's transcript, so subscribing to these would
  // double the delivery volume to learn nothing.
  it("accepts and ignores the event types it does not need", async () => {
    for (const type of ["call_started", "call_turn", "something_new"]) {
      expect((await post({ type, call: CALL }, "hook-secret")).status).toBe(200);
    }
    await settle();
    expect(record).not.toHaveBeenCalled();
  });

  // Cartesia retries on 5xx and on a timeout. A failure that is already logged and will be picked
  // up by the hourly sync should not invite a retry storm on top of it.
  it("still answers 200 when the work behind it throws", async () => {
    record.mockRejectedValue(new Error("db down"));
    expect((await post({ type: "call_completed", call: CALL }, "hook-secret")).status).toBe(200);
  });
});
