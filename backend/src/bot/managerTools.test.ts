import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The guard on manager-only tools, exercised through runTool itself.
 *
 * Tested here rather than only in managerAuth because the property that matters is not "the check
 * function works" — it is "the tool cannot run without it". A model that hallucinates the call, or
 * a future refactor that reorders the dispatcher, has to fail these.
 */

const mockPrisma = {
  business: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  customer: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  service: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  staffMember: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  faqEntry: { findMany: vi.fn(), create: vi.fn() },
  blockedTime: { findMany: vi.fn(), deleteMany: vi.fn() },
  customerCoupon: { findUnique: vi.fn(), create: vi.fn() },
  appointment: { findFirst: vi.fn(), findMany: vi.fn() },
};
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

const issueAndSendReceipt = vi.fn();
class NoInvoiceProviderError extends Error {}
vi.mock("../lib/receipts.js", () => ({
  issueAndSendReceipt: (...a: unknown[]) => issueAndSendReceipt(...a),
  NoInvoiceProviderError,
  DELIVERY_MESSAGE_HE: { sent: "נשלח", window_closed: "חלון סגור", no_whatsapp: "אין וואטסאפ", failed: "נכשל" },
}));

// Everything else runTool can reach, stubbed to nothing — these tests never take those paths.
vi.mock("./managerActions.js", () => ({
  daySchedule: vi.fn().mockResolvedValue([]),
  openingHours: vi.fn().mockResolvedValue([]),
  setDayHours: vi.fn(),
  listServices: vi.fn().mockResolvedValue([]),
  listStaff: vi.fn().mockResolvedValue([]),
  listFaq: vi.fn().mockResolvedValue([]),
  listWaitlist: vi.fn().mockResolvedValue([]),
  listBlocks: vi.fn().mockResolvedValue([]),
  minutesToHhmm: (n: number) => String(n),
  hhmmToMinutes: (t: string) => (t === "09:00" ? 540 : t === "17:00" ? 1020 : t === "10:00" ? 600 : null),
  dayNameToIndex: () => 2,
  businessSummary: vi.fn().mockResolvedValue({ confirmedThisMonth: 0, revenueThisMonthIls: 0, newCustomersThisMonth: 0, upcomingCount: 0 }),
  blockTime: vi.fn().mockResolvedValue({ id: "bt1" }),
  notifyCustomerOfCancellation: vi.fn().mockResolvedValue(true),
  dayBounds: () => ({ start: new Date(0), end: new Date(1) }),
  todayIn: () => "2026-09-01",
  BlockOverlapError: class extends Error {},
}));
vi.mock("../booking/actions.js", () => ({ cancelAppointmentById: vi.fn() }));

vi.mock("../booking/customerCoupons.js", () => ({
  quoteCustomerCoupon: vi.fn(),
  redeemCustomerCoupon: vi.fn(),
  releaseCustomerCoupon: vi.fn(),
  CustomerCouponError: class extends Error {},
  CUSTOMER_COUPON_FAILURE_HE: {},
}));

const { runTool } = await import("./claudeBot.js");

const OWNER = "972501234567";
const CUSTOMER = "972508888888";
const noSlots = { value: undefined };
const noPhotos = { value: undefined };

const receiptInput = { customerName: "דנה", amountIls: 200, description: "תספורת", confirmed: true };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.business.findUnique.mockResolvedValue({ name: "מספרת רונית", notificationPhone: OWNER });
  mockPrisma.customer.findMany.mockResolvedValue([{ id: "c1", name: "דנה כהן", phone: "972507777777" }]);
  issueAndSendReceipt.mockResolvedValue({ documentUrl: "https://inv/1", delivery: "sent" });
});

describe("issue_receipt authorisation", () => {
  it("issues for the owner's own number", async () => {
    const out = JSON.parse(await runTool("b1", OWNER, "issue_receipt", receiptInput, noSlots, noPhotos));

    expect(out.issued).toBe(true);
    expect(issueAndSendReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "b1", amountIls: 200, customerPhone: "972507777777" })
    );
  });

  it("refuses a customer, and issues nothing", async () => {
    const out = JSON.parse(await runTool("b1", CUSTOMER, "issue_receipt", receiptInput, noSlots, noPhotos));

    expect(out.issued).toBeUndefined();
    expect(out.error).toBeTruthy();
    expect(issueAndSendReceipt).not.toHaveBeenCalled();
  });

  it("refuses a customer even when the arguments name the owner", async () => {
    // The closest a prompt-injected model can get: calling the tool with the owner's details. The
    // guard never reads the arguments — only the phone Meta signed.
    const out = JSON.parse(
      await runTool("b1", CUSTOMER, "issue_receipt", { ...receiptInput, customerName: OWNER }, noSlots, noPhotos)
    );

    expect(out.error).toBeTruthy();
    expect(issueAndSendReceipt).not.toHaveBeenCalled();
  });

  it("refuses when the business has no owner number configured", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({ name: "x", notificationPhone: null });

    const out = JSON.parse(await runTool("b1", OWNER, "issue_receipt", receiptInput, noSlots, noPhotos));

    expect(out.error).toBeTruthy();
    expect(issueAndSendReceipt).not.toHaveBeenCalled();
  });

  it("does not reveal that the tool or the gate exists", async () => {
    const out = JSON.parse(await runTool("b1", CUSTOMER, "issue_receipt", receiptInput, noSlots, noPhotos));

    // A refusal that names the permission is a map of the permission.
    expect(out.error).not.toMatch(/manager|owner|permission|בעל|מנהל/i);
  });
});

describe("issue_receipt confirmation gate", () => {
  it("issues nothing on the first call and returns the details to read back", async () => {
    const out = JSON.parse(
      await runTool("b1", OWNER, "issue_receipt", { ...receiptInput, confirmed: undefined }, noSlots, noPhotos)
    );

    expect(out.needsConfirmation).toBe(true);
    expect(out.willIssue).toMatchObject({ amountIls: 200, description: "תספורת" });
    // A receipt cannot be deleted once issued, so the gate is code rather than an instruction.
    expect(issueAndSendReceipt).not.toHaveBeenCalled();
  });

  it("treats a non-true confirmed value as unconfirmed", async () => {
    const out = JSON.parse(
      await runTool("b1", OWNER, "issue_receipt", { ...receiptInput, confirmed: "yes" as unknown as boolean }, noSlots, noPhotos)
    );

    expect(out.needsConfirmation).toBe(true);
    expect(issueAndSendReceipt).not.toHaveBeenCalled();
  });
});

describe("issue_receipt input handling", () => {
  it("asks again rather than issuing when the customer is ambiguous", async () => {
    // Two Danas. Issuing a real accounting document against the wrong one is worse than a question.
    mockPrisma.customer.findMany.mockResolvedValue([
      { id: "c1", name: "דנה כהן", phone: "972507777777" },
      { id: "c2", name: "דנה לוי", phone: "972506666666" },
    ]);

    const out = JSON.parse(await runTool("b1", OWNER, "issue_receipt", receiptInput, noSlots, noPhotos));

    expect(out.error).toMatch(/No customer matching/);
    expect(issueAndSendReceipt).not.toHaveBeenCalled();
  });

  it("rejects a non-positive amount", async () => {
    const out = JSON.parse(
      await runTool("b1", OWNER, "issue_receipt", { ...receiptInput, amountIls: 0 }, noSlots, noPhotos)
    );

    expect(out.error).toBeTruthy();
    expect(issueAndSendReceipt).not.toHaveBeenCalled();
  });

  it("reports a missing invoicing provider as something the owner can fix", async () => {
    issueAndSendReceipt.mockRejectedValue(new NoInvoiceProviderError());

    const out = JSON.parse(await runTool("b1", OWNER, "issue_receipt", receiptInput, noSlots, noPhotos));

    expect(out.error).toMatch(/invoicing provider/i);
  });
});

describe("every manager tool is behind the same guard", () => {
  // Named individually rather than looped over MANAGER_ONLY_TOOLS so that adding a tool without a
  // guard test is a visible omission rather than a silently-passing loop.
  it.each([
    ["manager_help", {}],
    ["day_schedule", { date: "2026-09-01" }],
    ["business_summary", {}],
    ["block_time", { date: "2026-09-01", startTime: "14:00", endTime: "16:00", confirmed: true }],
    ["cancel_booking", { customerName: "דנה", confirmed: true }],
    ["issue_receipt", { customerName: "דנה", amountIls: 200, description: "תספורת", confirmed: true }],
    ["show_settings", { what: "hours" }],
    ["set_hours", { day: "שלישי", open: "09:00", close: "17:00", confirmed: true }],
    ["upsert_service", { name: "תספורת", priceIls: 100, durationMin: 30, confirmed: true }],
    ["manage_staff", { action: "add", name: "מיכל" }],
    ["add_faq", { question: "חניה?", answer: "יש", confirmed: true }],
    ["remove_block", { date: "2026-09-01", confirmed: true }],
    ["set_bot_enabled", { enabled: false, confirmed: true }],
    ["book_for_customer", { customerName: "דנה", serviceName: "תספורת", date: "2026-09-01", time: "10:00", confirmed: true }],
    ["add_customer", { name: "רותי", phone: "0501234567" }],
    ["set_customer_note", { customerName: "דנה", note: "בוקר" }],
    ["message_customer", { customerName: "דנה", text: "היי", confirmed: true }],
    ["create_discount_code", { code: "WELCOME10", percent: 10, confirmed: true }],
  ])("refuses %s from a customer", async (tool, input) => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue({ timezone: "Asia/Jerusalem" });

    const out = JSON.parse(await runTool("b1", CUSTOMER, tool, input, noSlots, noPhotos));

    expect(out.error).toBeTruthy();
    // Nothing that would only exist on a successful run.
    expect(
      out.issued ?? out.blocked ?? out.cancelled ?? out.appointments ?? out.youCanAskMeTo ??
      out.updated ?? out.saved ?? out.added ?? out.removed ?? out.booked ?? out.sent ?? out.created ??
      out.hours ?? out.services ?? out.staff ?? out.faq ?? out.waiting ?? out.blocks ??
      // A refusal must not even reach the confirmation step — that would leak that the tool is real.
      out.needsConfirmation
    ).toBeUndefined();
  });
});
