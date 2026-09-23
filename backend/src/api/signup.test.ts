import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Signup now requires the manager number. It is the number every owner alert goes to and the one
 * the manager tools trust; optional, it was left blank on most accounts and never filled in.
 */
const mockPrisma = {
  business: { findUnique: vi.fn(), create: vi.fn() },
  emailVerificationToken: { create: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({})) },
};
vi.mock("../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/rateLimit.js", () => ({ rateLimit: () => (_r: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../lib/auth.js", () => ({ signBusinessToken: () => "jwt", requireAuth: (_r: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../lib/email.js", () => ({
  APP_URL: "https://x",
  sendPasswordResetEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(async () => {}),
  sendAdminAlertEmail: vi.fn(async () => {}),
  sendEmailVerificationEmail: vi.fn(async () => {}),
}));
vi.mock("../lib/googleCalendar.js", () => ({
  getAuthUrl: vi.fn(),
  exchangeCode: vi.fn(),
  fetchGoogleUserInfo: vi.fn(),
  saveGoogleTokensFromResponse: vi.fn(),
  GoogleCalendarNotConfiguredError: class extends Error {},
}));

let app: express.Express;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  const { authRouter } = await import("./authRoutes.js");
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  mockPrisma.business.findUnique.mockResolvedValue(null);
  mockPrisma.business.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "b1", ...data }));
});

const base = { name: "מספרת רונית", email: "r@x.com", password: "correct-horse" };
const signup = (body: Record<string, unknown>) => request(app).post("/api/auth/signup").send(body);

it("refuses signup without a phone", async () => {
  const res = await signup(base);
  expect(res.status).toBe(400);
  expect(mockPrisma.business.create).not.toHaveBeenCalled();
});

it("refuses a phone that cannot be qualified, with the same sentence the settings page uses", async () => {
  const res = await signup({ ...base, notificationPhone: "abc" });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/לא נראה תקין/);
  expect(mockPrisma.business.create).not.toHaveBeenCalled();
});

it("stores the number fully qualified, the same shape the settings page saves", async () => {
  const res = await signup({ ...base, notificationPhone: "050-123-4567" });
  expect(res.status).toBe(201);
  expect(mockPrisma.business.create.mock.calls[0][0].data.notificationPhone).toBe("972501234567");
});

it("honours a foreign dial code", async () => {
  await signup({ ...base, notificationPhone: "2125551234", notificationPhoneDialCode: "1" });
  expect(mockPrisma.business.create.mock.calls[0][0].data.notificationPhone).toBe("12125551234");
});

it("checks the phone before the email, so a taken address is not reported for an unusable number", async () => {
  mockPrisma.business.findUnique.mockResolvedValue({ id: "other" });
  const res = await signup({ ...base, notificationPhone: "x" });
  expect(res.status).toBe(400);
  expect(res.body.error).not.toMatch(/already/i);
});
