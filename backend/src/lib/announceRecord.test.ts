import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = { systemSetting: { findUnique: vi.fn(), upsert: vi.fn() } };
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));

const { loadAnnounceRecord, markAnnounceSent } = await import("./announceRecord.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.systemSetting.upsert.mockResolvedValue({});
});

/** What the upsert actually stored, parsed back. */
const stored = () => JSON.parse(mockPrisma.systemSetting.upsert.mock.calls.at(-1)![0].create.value);

describe("reading the record", () => {
  it("returns the addresses already reached", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: '["972500000001","a@b.com"]' });

    const record = await loadAnnounceRecord("whatsapp", "x");

    expect(record.sent).toEqual(["972500000001", "a@b.com"]);
  });

  it("treats a missing row as nobody, so a first run actually sends", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
    expect((await loadAnnounceRecord("whatsapp", "x")).sent).toEqual([]);
  });

  it("treats an unreadable row as nobody rather than everybody", async () => {
    // The direction matters. Reading a corrupt row as "everyone has had it" would make the run
    // reach no one and report success; this way the mistake is visible, and only after a human
    // chose to send.
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: "{ this is not json" });
    expect((await loadAnnounceRecord("whatsapp", "x")).sent).toEqual([]);

    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: '{"not":"an array"}' });
    expect((await loadAnnounceRecord("whatsapp", "x")).sent).toEqual([]);
  });

  it("keeps channels apart, so an email send cannot silence a WhatsApp one", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue(null);

    await loadAnnounceRecord("whatsapp", "manage");
    const whatsappKey = mockPrisma.systemSetting.findUnique.mock.calls[0][0].where.key;
    await loadAnnounceRecord("email", "manage");
    const emailKey = mockPrisma.systemSetting.findUnique.mock.calls[1][0].where.key;

    expect(whatsappKey).not.toBe(emailKey);
  });
});

describe("writing the record", () => {
  it("adds addresses to what is already there", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: '["one"]' });
    const record = await loadAnnounceRecord("whatsapp", "x");

    await markAnnounceSent(record, ["two"]);

    expect(stored()).toEqual(["one", "two"]);
  });

  it("does not record the same address twice", async () => {
    // Marking is called per send and also in bulk by --mark-sent, so overlap is normal rather than
    // exceptional; a list that grows on every run would eventually be the whole customer base
    // repeated.
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: '["one"]' });
    const record = await loadAnnounceRecord("whatsapp", "x");

    await markAnnounceSent(record, ["one", "two", "two"]);

    expect(stored()).toEqual(["one", "two"]);
  });

  it("carries earlier writes forward within one run", async () => {
    // The in-memory record is what the loop reads between sends; if a write did not update it, the
    // second send would store a list missing the first.
    mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
    const record = await loadAnnounceRecord("whatsapp", "x");

    await markAnnounceSent(record, ["one"]);
    await markAnnounceSent(record, ["two"]);

    expect(stored()).toEqual(["one", "two"]);
  });
});
