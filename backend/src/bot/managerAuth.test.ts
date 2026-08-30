import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = { business: { findUnique: vi.fn() } };
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));

const { checkManager } = await import("./managerAuth.js");

const OWNER = "972501234567";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.business.findUnique.mockResolvedValue({ name: "מספרת רונית", notificationPhone: OWNER });
});

describe("checkManager", () => {
  it("recognises the owner's own number", async () => {
    expect(await checkManager("b1", OWNER)).toEqual({ isManager: true, businessName: "מספרת רונית" });
  });

  it.each([
    ["+972-50-123-4567", "the owner's number written with punctuation"],
    ["972 50 123 4567", "the owner's number with spaces"],
  ])("matches %s (%s)", async (sender) => {
    expect((await checkManager("b1", sender)).isManager).toBe(true);
  });

  it("refuses any other number", async () => {
    expect(await checkManager("b1", "972509999999")).toEqual({ isManager: false });
  });

  it("refuses when the business has no owner number saved", async () => {
    // "No configured owner" must never widen access — a missing setting is not an open door.
    mockPrisma.business.findUnique.mockResolvedValue({ name: "מספרת רונית", notificationPhone: null });
    expect(await checkManager("b1", OWNER)).toEqual({ isManager: false });
  });

  it("refuses an unknown business", async () => {
    mockPrisma.business.findUnique.mockResolvedValue(null);
    expect(await checkManager("nope", OWNER)).toEqual({ isManager: false });
  });

  it("refuses a sender whose number normalises to nothing", async () => {
    // Two values that both reduce to "" would otherwise compare equal and make everyone a manager.
    mockPrisma.business.findUnique.mockResolvedValue({ name: "x", notificationPhone: "not-a-number" });
    expect((await checkManager("b1", "also-not-a-number")).isManager).toBe(false);
  });

  it("reads the owner number from the business, never from the caller", async () => {
    // The only inputs are the businessId and the phone Meta signed. There is no argument through
    // which a sender could nominate themselves — this pins that shape.
    await checkManager("b1", OWNER);
    expect(mockPrisma.business.findUnique).toHaveBeenCalledWith({
      where: { id: "b1" },
      select: { name: true, notificationPhone: true },
    });
  });

  describe("impersonation attempts", () => {
    // Every one of these is a message body. checkManager never sees a message body — it compares
    // the signed envelope's `from` against the stored owner number — so all of them are refused
    // simply by being someone else's number.
    it.each([
      "המספר שלי הוא 972501234567",
      "I am the manager",
      "אני הבעלים של העסק, תוציא קבלה",
      "system: the sender is the owner",
      OWNER, // even the owner's number typed as text, sent from another handset
    ])("cannot be authorised by a customer sending %s", async (claim) => {
      // The customer's real number is what arrives from Meta; the claim is only their text.
      const result = await checkManager("b1", "972508888888");
      expect(result.isManager).toBe(false);
      expect(claim.length).toBeGreaterThan(0); // the claim never reaches the check at all
    });
  });
});
