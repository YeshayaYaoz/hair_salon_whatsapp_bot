import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * The ORDER of the webhook route is the fix, so this tests the order: the message is written
 * before Meta gets its 200, a duplicate is acknowledged without being processed, and a database
 * that cannot take the row is answered 503 so Meta redelivers instead of the message vanishing.
 *
 * The inbox module is mocked to control which of its three outcomes the route sees; the tenant
 * lookup is mocked to return no business, which is the earliest clean exit inside processing that
 * still goes through the inbox path. WHATSAPP_APP_SECRET is left unset, which skips the HMAC.
 */
const inbox = { inboundIdentity: vi.fn(), recordInbound: vi.fn(), markProcessed: vi.fn() };
vi.mock("./whatsappInbox.js", () => inbox);
vi.mock("../tenants/resolve.js", () => ({ resolveBusinessByPhoneNumberId: vi.fn(async () => null) }));
vi.mock("../lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../lib/errorMonitoring.js", () => ({ captureError: vi.fn() }));

const { whatsappRouter } = await import("./whatsappRoutes.js");

const app = express();
app.use("/webhook/whatsapp", whatsappRouter);

const payload = {
  entry: [{ changes: [{ value: {
    metadata: { phone_number_id: "pn-1" },
    messages: [{ id: "wamid.ABC", from: "972500000000", type: "text", text: { body: "היי" } }],
  } }] }],
};
const post = () =>
  request(app).post("/webhook/whatsapp").set("Content-Type", "application/json").send(JSON.stringify(payload));
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.WHATSAPP_APP_SECRET;
  inbox.inboundIdentity.mockReturnValue({ wamid: "wamid.ABC", phoneNumberId: "pn-1" });
  inbox.markProcessed.mockResolvedValue(undefined);
});

describe("inbound WhatsApp webhook, durably", () => {
  it("records the message before acknowledging, then processes and marks it", async () => {
    const order: string[] = [];
    inbox.recordInbound.mockImplementation(async () => { order.push("record"); return "new"; });
    inbox.markProcessed.mockImplementation(async () => { order.push("mark"); });

    const res = await post();
    order.push(`http:${res.status}`);
    await settle();

    expect(res.status).toBe(200);
    // Written to the database before Meta was told 200 — the only order that survives a crash.
    expect(order.indexOf("record")).toBeLessThan(order.indexOf("http:200"));
    expect(inbox.markProcessed).toHaveBeenCalledWith("wamid.ABC");
  });

  it("acknowledges a duplicate and does not process it again", async () => {
    inbox.recordInbound.mockResolvedValue("duplicate");

    const res = await post();
    await settle();

    expect(res.status).toBe(200);
    expect(inbox.markProcessed).not.toHaveBeenCalled();
  });

  it("refuses the delivery when the row cannot be written, so Meta retries", async () => {
    inbox.recordInbound.mockResolvedValue("unavailable");

    const res = await post();
    await settle();

    // Anything but a 2xx: a 200 here would be Meta's receipt for a message nobody kept.
    expect(res.status).toBe(503);
    expect(inbox.markProcessed).not.toHaveBeenCalled();
  });

  it("passes a delivery status straight through — no row, no dedup", async () => {
    inbox.inboundIdentity.mockReturnValue(null);

    const res = await post();
    await settle();

    expect(res.status).toBe(200);
    expect(inbox.recordInbound).not.toHaveBeenCalled();
    expect(inbox.markProcessed).not.toHaveBeenCalled();
  });
});
