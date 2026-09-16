import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = { business: { findUnique: vi.fn(), update: vi.fn() } };
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));

const { updateBusinessContact } = await import("./adminContact.js");

/**
 * The phone is the number the manager tools trust and the email is the login. Both are edited
 * here by an operator on someone else's behalf, which is why every rule is pinned.
 */
const current = { notificationPhone: "972501111111", email: "owner@x.com" };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.business.findUnique.mockImplementation(async ({ where }: { where: { id?: string; email?: string } }) =>
    where.id ? current : null // by id → the business; by email → nobody else has it
  );
  mockPrisma.business.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...current, ...data }));
});

describe("the phone", () => {
  it("is normalised the same way the owner's own edit is", async () => {
    const r = await updateBusinessContact("b1", { notificationPhone: "050-222-2222" });
    expect(r).toMatchObject({ ok: true, notificationPhone: "972502222222", changed: ["notificationPhone"] });
  });

  it("is rejected when it cannot be qualified, with the same sentence the owner would see", async () => {
    const r = await updateBusinessContact("b1", { notificationPhone: "abc" });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });

  it("resets verification when it changes — a new number is an unproven number", async () => {
    await updateBusinessContact("b1", { notificationPhone: "0502222222" });
    expect(mockPrisma.business.update.mock.calls[0][0].data).toMatchObject({ notificationPhoneVerifiedAt: null });
  });

  it("writes nothing when the number is the one already saved", async () => {
    const r = await updateBusinessContact("b1", { notificationPhone: "0501111111" });
    expect(r).toMatchObject({ ok: true, changed: [] });
    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });

  it("clears on empty, and clears verification with it", async () => {
    await updateBusinessContact("b1", { notificationPhone: "  " });
    expect(mockPrisma.business.update.mock.calls[0][0].data).toEqual({ notificationPhone: null, notificationPhoneVerifiedAt: null });
  });
});

describe("the email", () => {
  it("is lowercased and trimmed — it is the login key", async () => {
    const r = await updateBusinessContact("b1", { email: "  New@Example.COM " });
    expect(r).toMatchObject({ ok: true, email: "new@example.com", changed: ["email"] });
  });

  it("is rejected when malformed", async () => {
    const r = await updateBusinessContact("b1", { email: "not-an-email" });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("is refused when another business already logs in with it", async () => {
    mockPrisma.business.findUnique.mockImplementation(async ({ where }: { where: { id?: string; email?: string } }) =>
      where.id ? current : { id: "someone-else" }
    );
    const r = await updateBusinessContact("b1", { email: "taken@x.com" });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(mockPrisma.business.update).not.toHaveBeenCalled();
  });

  it("does not touch emailVerifiedAt — resetting it would lock the owner out of login", async () => {
    await updateBusinessContact("b1", { email: "new@x.com" });
    expect(mockPrisma.business.update.mock.calls[0][0].data).not.toHaveProperty("emailVerifiedAt");
  });
});

it("reports which fields actually changed, for the audit line", async () => {
  const r = await updateBusinessContact("b1", { notificationPhone: "0502222222", email: "owner@x.com" });
  expect(r).toMatchObject({ ok: true, changed: ["notificationPhone"] });
});

it("says so for a business that does not exist", async () => {
  mockPrisma.business.findUnique.mockResolvedValue(null);
  expect(await updateBusinessContact("nope", { email: "a@b.c" })).toMatchObject({ ok: false, status: 404 });
});
