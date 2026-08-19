import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  business: { findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
};
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));

const sendAdminAlertEmail = vi.fn();
vi.mock("./email.js", () => ({ sendAdminAlertEmail: (...a: unknown[]) => sendAdminAlertEmail(...a) }));
vi.mock("./errorMonitoring.js", () => ({ captureError: vi.fn() }));

const assignNumberToAgent = vi.fn();
vi.mock("./cartesiaAdmin.js", () => ({ assignNumberToAgent: (...a: unknown[]) => assignNumberToAgent(...a) }));

const getBalance = vi.fn();
const listAvailableNumbers = vi.fn();
const orderNumber = vi.fn();
const pointNumberAtCartesia = vi.fn();
vi.mock("./zadarmaAdmin.js", () => ({
  getBalance: (...a: unknown[]) => getBalance(...a),
  listAvailableNumbers: (...a: unknown[]) => listAvailableNumbers(...a),
  orderNumber: (...a: unknown[]) => orderNumber(...a),
  pointNumberAtCartesia: (...a: unknown[]) => pointNumberAtCartesia(...a),
}));

const { provisionVoiceNumber, mayOrderNumber, AlreadyHasNumberError } = await import("./numberProvisioning.js");

function business(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    name: "מספרת רונית",
    email: "r@example.com",
    subscriptionStatus: "active",
    subscriptionPlan: "premium",
    blockedAt: null,
    voicePhoneNumber: null,
    voiceNumberOrderedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.business.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.business.update.mockResolvedValue({});
  getBalance.mockResolvedValue({ balance: 12, currency: "USD" });
  listAvailableNumbers.mockResolvedValue([{ number: "972559661420" }]);
  orderNumber.mockResolvedValue("972559661420");
});

describe("mayOrderNumber", () => {
  it("lets an active subscriber order", () => {
    expect(mayOrderNumber({ subscriptionStatus: "active", blockedAt: null })).toBe(true);
  });

  it("does not let a trial order", () => {
    // A trial that never converts would leave a number billing every month forever.
    expect(mayOrderNumber({ subscriptionStatus: "trial", blockedAt: null })).toBe(false);
  });

  it("does not let past_due order", () => {
    // Adding a recurring charge to an account that is already failing to pay is the wrong direction.
    expect(mayOrderNumber({ subscriptionStatus: "past_due", blockedAt: null })).toBe(false);
  });

  it("does not let a blocked business order, even while active", () => {
    expect(mayOrderNumber({ subscriptionStatus: "active", blockedAt: new Date() })).toBe(false);
  });
});

describe("provisionVoiceNumber", () => {
  it("orders and wires both halves for a paying business", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business());

    const result = await provisionVoiceNumber("b1");

    expect(result).toEqual({ status: "ordered", number: "972559661420" });
    // Either half alone is a number that does not ring while looking configured.
    expect(assignNumberToAgent).toHaveBeenCalledWith("+972559661420", { label: "מספרת רונית" });
    expect(pointNumberAtCartesia).toHaveBeenCalledWith("+972559661420");
  });

  it("asks the operator instead of ordering for a trial", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business({ subscriptionStatus: "trial" }));

    const result = await provisionVoiceNumber("b1");

    expect(result).toEqual({ status: "approval_requested" });
    expect(orderNumber).not.toHaveBeenCalled();
    expect(sendAdminAlertEmail).toHaveBeenCalled();
  });

  it("claims the row before calling the carrier", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business());

    await provisionVoiceNumber("b1");

    const claim = mockPrisma.business.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: "b1", voiceNumberOrderedAt: null });
  });

  it("still offers a number when voicePhoneNumber holds the WhatsApp line", async () => {
    // Connecting WhatsApp copies the WhatsApp number into voicePhoneNumber. Treating that as "already
    // has a number" refused every business that finished onboarding — which is all of them.
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business({ voicePhoneNumber: "972501111111" }));

    const result = await provisionVoiceNumber("b1");

    expect(result).toEqual({ status: "ordered", number: "972559661420" });
  });

  it("refuses when another request already claimed the order", async () => {
    // Two clicks half a second apart both pass a "has a number?" check, because voicePhoneNumber is
    // only set after the order returns. Without the claim the business pays monthly for two numbers.
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business());
    mockPrisma.business.updateMany.mockResolvedValue({ count: 0 });

    await expect(provisionVoiceNumber("b1")).rejects.toBeInstanceOf(AlreadyHasNumberError);
    expect(orderNumber).not.toHaveBeenCalled();
  });

  it("refuses when a number was already ordered for the business", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(
      business({ voicePhoneNumber: "972500000000", voiceNumberOrderedAt: new Date() })
    );

    await expect(provisionVoiceNumber("b1")).rejects.toBeInstanceOf(AlreadyHasNumberError);
    expect(orderNumber).not.toHaveBeenCalled();
  });

  it("does not order on a zero balance", async () => {
    // The order would succeed as a reservation that can never ring, and the later failure says
    // nothing about money.
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business());
    getBalance.mockResolvedValue({ balance: 0, currency: "USD" });

    await expect(provisionVoiceNumber("b1")).rejects.toThrow(/balance/i);
    expect(orderNumber).not.toHaveBeenCalled();
  });

  it("releases the claim when the order fails, so a retry is possible", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business());
    orderNumber.mockRejectedValue(new Error("carrier down"));

    await expect(provisionVoiceNumber("b1")).rejects.toThrow("carrier down");

    const release = mockPrisma.business.updateMany.mock.calls.at(-1)![0];
    expect(release.data).toEqual({ voiceNumberOrderedAt: null });
    // Guarded on the number being unchanged, so a release can never undo a successful order.
    expect(release.where).toMatchObject({ voicePhoneNumber: null });
  });

  it("uses the number Zadarma allocated, not the one requested", async () => {
    // Asking for one number and getting another is documented Zadarma behaviour, and configuring
    // the requested one is how the wrong number ends up in three places.
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business());
    listAvailableNumbers.mockResolvedValue([{ number: "972555077983" }]);
    orderNumber.mockResolvedValue("972559661420");

    const result = await provisionVoiceNumber("b1");

    expect(result.number).toBe("972559661420");
    expect(pointNumberAtCartesia).toHaveBeenCalledWith("+972559661420");
  });
});
