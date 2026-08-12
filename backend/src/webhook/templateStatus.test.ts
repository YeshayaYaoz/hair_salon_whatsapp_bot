import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A rejected template is the failure that needs no person per business — one operator fix serves
 * every salon — but it was also the one nobody could see. Templates are submitted automatically at
 * connect and Meta answers asynchronously, so a rejection left reminders and review requests dead
 * for that business while the dashboard showed a healthy connection.
 */

const mockPrisma = { business: { findFirst: vi.fn() } };
const sendAdminAlertEmail = vi.fn(async () => {});

vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/email.js", () => ({ sendAdminAlertEmail: (...a: unknown[]) => sendAdminAlertEmail(...(a as [])) }));

const { handleTemplateStatusUpdate } = await import("./templateStatus.js");

describe("handleTemplateStatusUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.business.findFirst.mockResolvedValue({ id: "biz1", name: "מספרת רונית", email: "r@x.test" });
  });

  it("alerts the operator when Meta rejects a template, with the reason", async () => {
    await handleTemplateStatusUpdate("waba1", {
      event: "REJECTED",
      message_template_name: "tori_owner_alert",
      message_template_language: "he",
      reason: "INVALID_FORMAT",
    });
    const [subject, body] = sendAdminAlertEmail.mock.calls[0] as unknown as [string, string];
    expect(subject).toContain("מספרת רונית");
    expect(body).toContain("tori_owner_alert");
    expect(body).toContain("INVALID_FORMAT");
  });

  it("also alerts when a live template is paused or disabled", async () => {
    // A template can be approved and later switched off for poor quality. Same consequence as a
    // rejection — undelivered messages — so it cannot be quieter.
    for (const event of ["PAUSED", "DISABLED"]) {
      sendAdminAlertEmail.mockClear();
      await handleTemplateStatusUpdate("waba1", { event, message_template_name: "tori_appointment_reminder" });
      expect(sendAdminAlertEmail).toHaveBeenCalledOnce();
    }
  });

  it("stays quiet on approval", async () => {
    await handleTemplateStatusUpdate("waba1", { event: "APPROVED", message_template_name: "tori_review_request" });
    expect(sendAdminAlertEmail).not.toHaveBeenCalled();
  });

  it("does not alarm on a category change, which is a pricing change and not a failure", async () => {
    // Meta moves UTILITY to MARKETING when it reads marketing intent. Worth logging, not worth
    // waking someone: the template still sends.
    await handleTemplateStatusUpdate("waba1", {
      event: "CATEGORY_CHANGE",
      message_template_name: "tori_review_request",
      previous_category: "UTILITY",
      new_category: "MARKETING",
    });
    expect(sendAdminAlertEmail).not.toHaveBeenCalled();
  });

  it("still reports a rejection for a WABA no business row claims", async () => {
    // Tori's own outreach WABA has no Business row, and its templates matter just as much.
    mockPrisma.business.findFirst.mockResolvedValue(null);
    await handleTemplateStatusUpdate("waba-unknown", { event: "REJECTED", message_template_name: "tori_outreach_intro" });
    expect((sendAdminAlertEmail.mock.calls[0] as unknown as string[])[0]).toContain("waba-unknown");
  });

  it("never throws into the webhook when the alert itself fails", async () => {
    // This runs inside Meta's webhook delivery. Throwing would have Meta retry, and repeated
    // retries against a failing mailer are how a webhook subscription gets disabled.
    sendAdminAlertEmail.mockRejectedValue(new Error("mailer down"));
    await expect(
      handleTemplateStatusUpdate("waba1", { event: "REJECTED", message_template_name: "x" })
    ).resolves.toBeUndefined();
  });
});
