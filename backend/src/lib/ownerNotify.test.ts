import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  business: { findUnique: vi.fn(), update: vi.fn() },
};
const mockSendWhatsAppMessage = vi.fn();

vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("./crypto.js", () => ({ decryptSecret: (v: string) => v }));
vi.mock("../webhook/whatsappClient.js", () => ({ sendWhatsAppMessage: mockSendWhatsAppMessage }));

const { notifyOwner } = await import("./ownerNotify.js");

function connectedBusiness(overrides: Record<string, unknown> = {}) {
  return {
    notificationPhone: "972501234567",
    notificationPhoneVerifiedAt: null,
    whatsappPhoneNumberId: "pn1",
    whatsappAccessToken: "token",
    ...overrides,
  };
}

describe("notifyOwner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.business.update.mockResolvedValue({});
    mockSendWhatsAppMessage.mockResolvedValue(undefined);
  });

  it("marks the notification phone verified once a send actually succeeds", async () => {
    // The send is the only thing that proves the number is real and reachable — which is what makes
    // verification self-healing: a business whose number already works gets marked by its next
    // ordinary booking alert, without anyone pressing anything.
    mockPrisma.business.findUnique.mockResolvedValue(connectedBusiness());

    await expect(notifyOwner("biz1", "hello")).resolves.toBe(true);

    expect(mockPrisma.business.update).toHaveBeenCalledWith({
      where: { id: "biz1" },
      data: { notificationPhoneVerifiedAt: expect.any(Date) },
    });
  });

  it("does not rewrite the timestamp on every later alert", async () => {
    mockPrisma.business.findUnique.mockResolvedValue(
      connectedBusiness({ notificationPhoneVerifiedAt: new Date("2026-01-01") })
    );

    await notifyOwner("biz1", "hello");

    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });

  it("does not mark verified when the send fails", async () => {
    // A number that Meta rejected is exactly the number the setup checklist needs to keep flagging.
    mockPrisma.business.findUnique.mockResolvedValue(connectedBusiness());
    mockSendWhatsAppMessage.mockRejectedValue(new Error("invalid recipient"));

    await expect(notifyOwner("biz1", "hello")).resolves.toBe(false);
    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });

  it("reports failure when there is no notification phone at all", async () => {
    // The caller relies on this: claudeBot uses the return value to decide whether it may promise
    // the customer a callback.
    mockPrisma.business.findUnique.mockResolvedValue(connectedBusiness({ notificationPhone: null }));

    await expect(notifyOwner("biz1", "hello")).resolves.toBe(false);
    expect(mockSendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("still reports success if only the verification write fails", async () => {
    // The owner was notified; bookkeeping is secondary and must not claim otherwise.
    mockPrisma.business.findUnique.mockResolvedValue(connectedBusiness());
    mockPrisma.business.update.mockRejectedValue(new Error("db down"));

    await expect(notifyOwner("biz1", "hello")).resolves.toBe(true);
  });
});
