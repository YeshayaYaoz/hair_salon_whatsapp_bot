import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  affiliateReferral: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  business: { findUnique: vi.fn() },
};
const mockSendAdminAlertEmail = vi.fn();

vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("./email.js", () => ({ sendAdminAlertEmail: mockSendAdminAlertEmail }));

const { recordAffiliateClick, markAffiliateConversion } = await import("./affiliates.js");

describe("affiliate referrals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.business.findUnique.mockResolvedValue({ name: "Salon Dana", email: "dana@example.com" });
    mockPrisma.affiliateReferral.update.mockResolvedValue({});
  });

  it("records a click without alerting anyone", async () => {
    // A click is curiosity, not a conversion — emailing on every one would train the operator to
    // ignore the alert that matters.
    await recordAffiliateClick("biz1", "payplus", "payments");
    expect(mockPrisma.affiliateReferral.upsert).toHaveBeenCalledOnce();
    expect(mockSendAdminAlertEmail).not.toHaveBeenCalled();
  });

  it("alerts the operator when a referred salon connects the provider", async () => {
    mockPrisma.affiliateReferral.findUnique.mockResolvedValue({
      id: "ref1",
      clickedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      convertedAt: null,
    });

    await markAffiliateConversion({ businessId: "biz1", provider: "payplus", kind: "payments" });

    expect(mockPrisma.affiliateReferral.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ref1" }, data: { convertedAt: expect.any(Date) } })
    );
    expect(mockSendAdminAlertEmail).toHaveBeenCalledOnce();
    const [subject, body] = mockSendAdminAlertEmail.mock.calls[0];
    expect(subject).toContain("Salon Dana");
    // The businessId has to be in the body: it is the sub-id PayPlus's dashboard reports back, and
    // the only way to match one of their rows to one of ours.
    expect(body).toContain("biz1");
  });

  it("does not alert twice if the salon reconnects", async () => {
    mockPrisma.affiliateReferral.findUnique.mockResolvedValue({
      id: "ref1",
      clickedAt: new Date(),
      convertedAt: new Date(),
    });

    await markAffiliateConversion({ businessId: "biz1", provider: "payplus", kind: "payments" });

    expect(mockPrisma.affiliateReferral.update).not.toHaveBeenCalled();
    expect(mockSendAdminAlertEmail).not.toHaveBeenCalled();
  });

  it("stays silent for a salon we never referred", async () => {
    mockPrisma.affiliateReferral.findUnique.mockResolvedValue(null);
    await markAffiliateConversion({ businessId: "biz1", provider: "payplus", kind: "payments" });
    expect(mockSendAdminAlertEmail).not.toHaveBeenCalled();
  });

  it("counts PayPlus Invoice+ as a PayPlus conversion", async () => {
    // Invoice+ connects under its own provider id, but it is the same company behind the same
    // affiliate link — the invoice link is the payments one with &inv=true. Without the mapping
    // every Invoice+ conversion would be missed.
    mockPrisma.affiliateReferral.findUnique.mockResolvedValue({
      id: "ref2", clickedAt: new Date(), convertedAt: null,
    });

    await markAffiliateConversion({ businessId: "biz1", provider: "payplus-invoice", kind: "invoice" });

    expect(mockPrisma.affiliateReferral.findUnique).toHaveBeenCalledWith({
      where: { businessId_provider_kind: { businessId: "biz1", provider: "payplus", kind: "invoice" } },
    });
    expect(mockSendAdminAlertEmail).toHaveBeenCalledOnce();
  });

  it("ignores providers we have no affiliate deal with", async () => {
    await markAffiliateConversion({ businessId: "biz1", provider: "tranzila", kind: "payments" });
    expect(mockPrisma.affiliateReferral.findUnique).not.toHaveBeenCalled();
  });

  it("never throws — a bookkeeping failure must not fail the salon's connection", async () => {
    mockPrisma.affiliateReferral.findUnique.mockRejectedValue(new Error("db down"));
    await expect(
      markAffiliateConversion({ businessId: "biz1", provider: "payplus", kind: "payments" })
    ).resolves.toBeUndefined();
  });
});
