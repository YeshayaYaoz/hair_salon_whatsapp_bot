import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What a customer sees when they tap the business name in WhatsApp.
 *
 * An owner fills in address, site and category during setup in Tori, and none of it used to reach
 * WhatsApp — the card stayed blank and the only fix was retyping everything in Meta's console. The
 * profile picture was the one field ever pushed, which is what made the gap easy to miss: the
 * picture showed up, so the card looked handled.
 */

const mockPrisma = { business: { findUnique: vi.fn() } };
const setWhatsAppBusinessProfile = vi.fn(async () => {});

vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("./crypto.js", () => ({ decryptSecret: (s: string) => `dec:${s}` }));
vi.mock("../webhook/whatsappClient.js", () => ({
  setWhatsAppBusinessProfile: (...a: unknown[]) => setWhatsAppBusinessProfile(...(a as [])),
}));

const { syncWhatsAppProfile } = await import("./whatsappProfile.js");

const CONNECTED = {
  name: "צימר בנחת רוח",
  email: "meron@example.com",
  address: "מירון",
  businessType: "bnb",
  greetingButtonUrl: "zimmermeron.co.il",
  whatsappPhoneNumberId: "pn1",
  whatsappAccessToken: "enc",
  whatsappTokenValid: true,
};

const sent = () => setWhatsAppBusinessProfile.mock.calls[0][0] as Record<string, unknown>;

describe("syncWhatsAppProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.business.findUnique.mockResolvedValue({ ...CONNECTED });
  });

  it("pushes what the owner already entered in Tori", async () => {
    await syncWhatsAppProfile("biz1");
    expect(sent()).toMatchObject({
      phoneNumberId: "pn1",
      accessToken: "dec:enc",
      address: "מירון",
      email: "meron@example.com",
    });
  });

  it("gives a bare domain the scheme Meta requires", async () => {
    // Owners type "zimmermeron.co.il" — this is a text box in Tori, not a URL field, and Meta
    // rejects the whole request over it rather than just dropping the website.
    await syncWhatsAppProfile("biz1");
    expect(sent().websites).toEqual(["https://zimmermeron.co.il"]);
  });

  it("maps the business type to one of Meta's fixed verticals", async () => {
    await syncWhatsAppProfile("biz1");
    expect(sent().vertical).toBe("HOTEL");

    // Meta has no "barber" or "aesthetics" category; BEAUTY is the closest honest fit, and an
    // unmapped value would fail the request and take the address down with it.
    for (const [type, vertical] of [["barber", "BEAUTY"], ["aesthetics", "BEAUTY"], ["clinic", "HEALTH"]]) {
      setWhatsAppBusinessProfile.mockClear();
      mockPrisma.business.findUnique.mockResolvedValue({ ...CONNECTED, businessType: type });
      await syncWhatsAppProfile("biz1");
      expect(sent().vertical).toBe(vertical);
    }
  });

  it("sends no vertical at all for a type Meta has no category for", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({ ...CONNECTED, businessType: "something_new" });
    await syncWhatsAppProfile("biz1");
    expect(sent().vertical).toBeUndefined();
  });

  it("does nothing for a business with no WhatsApp connected", async () => {
    mockPrisma.business.findUnique.mockResolvedValue({ ...CONNECTED, whatsappPhoneNumberId: null });
    await syncWhatsAppProfile("biz1");
    expect(setWhatsAppBusinessProfile).not.toHaveBeenCalled();
  });

  it("does not call Meta with a token already known to be dead", async () => {
    // A guaranteed 401 on every settings save. The owner is already being told to reconnect by
    // whatsappHealthJob; a second failure adds noise and no information.
    mockPrisma.business.findUnique.mockResolvedValue({ ...CONNECTED, whatsappTokenValid: false });
    await syncWhatsAppProfile("biz1");
    expect(setWhatsAppBusinessProfile).not.toHaveBeenCalled();
  });
});
