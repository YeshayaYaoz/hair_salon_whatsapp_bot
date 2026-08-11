import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const mockPrisma = {
  outreachMessage: { findUnique: vi.fn(), update: vi.fn() },
  consentLog: { findFirst: vi.fn() },
};
const sendOutreachEmail = vi.fn();
const outreachReplyTo = vi.fn(() => "sales@torionline.com" as string | null);

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
// Auth is pass-through here: these tests are about the send guards, not the admin gate, and the
// real middlewares would drag the whole businessRoutes module (and its env expectations) along.
vi.mock("../lib/auth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../api/businessRoutes.js", () => ({
  requireSuperAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/email.js", () => ({
  APP_URL: "https://app.test",
  sendTrialAccountCreatedEmail: vi.fn(),
  sendOutreachEmail: (...args: unknown[]) => sendOutreachEmail(...args),
  outreachReplyTo: () => outreachReplyTo(),
}));
vi.mock("./runner.js", () => ({ executeLeadFinderRun: vi.fn() }));
vi.mock("./outreach.js", () => ({ generateOutreachDraft: vi.fn() }));
vi.mock("../webhook/whatsappClient.js", () => ({ sendWhatsAppTemplate: vi.fn() }));

const { leadFinderRouter } = await import("./routes.js");

const approvedDraft = {
  id: "msg1",
  leadId: "lead1",
  channel: "email",
  approvalStatus: "approved",
  sentAt: null,
  subject: "הזמנה לפיילוט",
  body: "שלום",
};

/**
 * The broadcast route always had these guards; the per-lead send had neither, which made the
 * protections bulk-only: an opted-out lead could still be mailed one message at a time, and a
 * hand-approved draft could still send from noreply with nowhere for a reply to land.
 */
describe("POST /outreach/:id/send", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    outreachReplyTo.mockReturnValue("sales@torionline.com");
    mockPrisma.outreachMessage.findUnique.mockResolvedValue(approvedDraft);
    mockPrisma.outreachMessage.update.mockResolvedValue({ ...approvedDraft, sentAt: new Date() });
    mockPrisma.consentLog.findFirst.mockResolvedValue(null);
    app = express();
    app.use(express.json());
    app.use("/api/leadfinder", leadFinderRouter);
  });

  const send = () =>
    request(app).post("/api/leadfinder/outreach/msg1/send").send({ toEmail: "owner@salon.test" });

  it("sends an approved draft when nothing stands in the way", async () => {
    const res = await send();
    expect(res.status).toBe(200);
    expect(sendOutreachEmail).toHaveBeenCalledWith("owner@salon.test", "הזמנה לפיילוט", "שלום");
  });

  it("refuses to mail a lead who opted out, even one message at a time", async () => {
    // "הסר" recorded from any channel lands in ConsentLog; a follow-up sent past it is the
    // Israeli spam-law violation the log exists to prevent, hand-approved or not.
    mockPrisma.consentLog.findFirst.mockResolvedValue({ id: "c1", leadId: "lead1", event: "opted_out" });
    const res = await send();
    expect(res.status).toBe(409);
    expect(sendOutreachEmail).not.toHaveBeenCalled();
    // And the draft must not be marked sent — nothing went out.
    expect(mockPrisma.outreachMessage.update).not.toHaveBeenCalled();
  });

  it("refuses to send email nobody can answer", async () => {
    // Same rule as the broadcast: outreach goes out from noreply@, so without OUTREACH_REPLY_TO a
    // reply — the entire point of the email — lands in an unread mailbox.
    outreachReplyTo.mockReturnValue(null);
    const res = await send();
    expect(res.status).toBe(400);
    expect(sendOutreachEmail).not.toHaveBeenCalled();
  });

  it("still refuses an unapproved draft", async () => {
    mockPrisma.outreachMessage.findUnique.mockResolvedValue({ ...approvedDraft, approvalStatus: "draft" });
    expect((await send()).status).toBe(400);
  });

  it("still refuses a double send", async () => {
    mockPrisma.outreachMessage.findUnique.mockResolvedValue({ ...approvedDraft, sentAt: new Date() });
    expect((await send()).status).toBe(409);
  });
});
