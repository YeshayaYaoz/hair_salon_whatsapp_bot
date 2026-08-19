import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = { business: { findUniqueOrThrow: vi.fn(), update: vi.fn() } };
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("./crypto.js", () => ({ encryptSecret: (s: string) => `enc(${s})` }));
const sendAdminAlertEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("./email.js", () => ({ sendAdminAlertEmail: (...a: unknown[]) => sendAdminAlertEmail(...a) }));
vi.mock("./errorMonitoring.js", () => ({ captureError: vi.fn() }));
const submitWhatsAppTemplates = vi.fn().mockResolvedValue([]);
vi.mock("./submitTemplates.js", () => ({ submitWhatsAppTemplates: (...a: unknown[]) => submitWhatsAppTemplates(...a) }));

const addPhoneNumberToWaba = vi.fn();
const requestVerificationCode = vi.fn();
const verifyCode = vi.fn();
const registerOnCloudApi = vi.fn();
const subscribeWabaToApp = vi.fn();
const getPhoneNumber = vi.fn();
class MetaApiError extends Error {
  code?: number;
  constructor(m: string, code?: number) { super(m); this.code = code; }
}
vi.mock("./metaPhoneNumbers.js", () => ({
  addPhoneNumberToWaba: (...a: unknown[]) => addPhoneNumberToWaba(...a),
  requestVerificationCode: (...a: unknown[]) => requestVerificationCode(...a),
  verifyCode: (...a: unknown[]) => verifyCode(...a),
  registerOnCloudApi: (...a: unknown[]) => registerOnCloudApi(...a),
  subscribeWabaToApp: (...a: unknown[]) => subscribeWabaToApp(...a),
  getPhoneNumber: (...a: unknown[]) => getPhoneNumber(...a),
  MetaApiError,
}));

const readVerificationCodeFromCall = vi.fn();
vi.mock("./verificationCode.js", () => ({
  readVerificationCodeFromCall: (...a: unknown[]) => readVerificationCodeFromCall(...a),
}));

const { startWhatsAppAutoSetup } = await import("./whatsappAutoSetup.js");

function business(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    name: "מספרת רונית",
    voicePhoneNumber: "972559661420",
    whatsappPhoneNumberId: null,
    whatsappRegistrationPin: null,
    whatsappRegisteredAt: null,
    whatsappAutoSetupAttempts: 0,
    ...overrides,
  };
}

/** Runs the fire-and-forget entry and waits for it to settle (it never rejects). */
async function run(): Promise<void> {
  startWhatsAppAutoSetup("b1");
  // The run is async all the way down; flush the microtask/timer chain until state stops changing.
  for (let i = 0; i < 60; i++) await vi.advanceTimersByTimeAsync(30_000);
}

function states(): string[] {
  return mockPrisma.business.update.mock.calls
    .map((c) => c[0]?.data?.whatsappAutoSetupState)
    .filter(Boolean);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  process.env.TORI_WABA_ID = "waba1";
  process.env.META_SYSTEM_USER_TOKEN = "tok";
  mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business());
  mockPrisma.business.update.mockResolvedValue({});
  addPhoneNumberToWaba.mockResolvedValue("pn_1");
  getPhoneNumber.mockResolvedValue({ id: "pn_1", codeVerificationStatus: "NOT_VERIFIED" });
  requestVerificationCode.mockResolvedValue(undefined);
  readVerificationCodeFromCall.mockResolvedValue("482917");
  verifyCode.mockResolvedValue(undefined);
  registerOnCloudApi.mockResolvedValue(undefined);
  subscribeWabaToApp.mockResolvedValue(undefined);
});

describe("whatsappAutoSetup", () => {
  it("drives the full sequence and wires the business", async () => {
    await run();

    expect(addPhoneNumberToWaba).toHaveBeenCalledWith("waba1", "+972559661420", "מספרת רונית", "tok");
    expect(requestVerificationCode).toHaveBeenCalledWith("pn_1", "tok", "VOICE");
    expect(verifyCode).toHaveBeenCalledWith("pn_1", "482917", "tok");
    expect(registerOnCloudApi).toHaveBeenCalledWith("pn_1", expect.stringMatching(/^\d{6}$/), "tok");
    expect(subscribeWabaToApp).toHaveBeenCalledWith("waba1", "tok");

    const wiring = mockPrisma.business.update.mock.calls.find((c) => c[0]?.data?.whatsappPhoneNumberId);
    expect(wiring![0].data).toMatchObject({
      whatsappPhoneNumberId: "pn_1",
      whatsappWabaId: "waba1",
      whatsappAccessToken: "enc(tok)",
      whatsappTokenValid: true,
    });
    expect(submitWhatsAppTemplates).toHaveBeenCalledWith("b1", "pn_1", "tok", "waba1");
    expect(states().at(-1)).toBe("done");
  });

  it("stores the PIN before registering, and reuses a stored one", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business({ whatsappRegistrationPin: "123456" }));

    await run();

    expect(registerOnCloudApi).toHaveBeenCalledWith("pn_1", "123456", "tok");
  });

  it("skips code verification when Meta already shows the number verified", async () => {
    // A retry after a crash between verify and register must not burn another code request.
    getPhoneNumber.mockResolvedValue({ id: "pn_1", codeVerificationStatus: "VERIFIED" });

    await run();

    expect(requestVerificationCode).not.toHaveBeenCalled();
    expect(verifyCode).not.toHaveBeenCalled();
    expect(registerOnCloudApi).toHaveBeenCalled();
    expect(states().at(-1)).toBe("done");
  });

  it("does nothing for a business that is already registered", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business({ whatsappRegisteredAt: new Date() }));

    await run();

    expect(addPhoneNumberToWaba).not.toHaveBeenCalled();
    expect(states().at(-1)).toBe("done");
  });

  it("gives up before Meta's code-request lockout and tells the operator", async () => {
    mockPrisma.business.findUniqueOrThrow.mockResolvedValue(business({ whatsappAutoSetupAttempts: 2 }));

    await run();

    expect(requestVerificationCode).not.toHaveBeenCalled();
    expect(states().at(-1)).toBe("failed");
    expect(sendAdminAlertEmail).toHaveBeenCalled();
  });

  it("fails with the operator emailed when the call never becomes readable", async () => {
    readVerificationCodeFromCall.mockResolvedValue(null);

    await run();

    expect(verifyCode).not.toHaveBeenCalled();
    expect(states().at(-1)).toBe("failed");
    expect(sendAdminAlertEmail).toHaveBeenCalledWith(
      expect.stringContaining("b1"),
      expect.stringContaining("not readable")
    );
  });

  it("treats Meta's 133016 too-many-attempts as non-fatal on register", async () => {
    // The number may already be registered from a prior run; the wiring must still complete.
    registerOnCloudApi.mockRejectedValue(new MetaApiError("too many attempts", 133016));

    await run();

    expect(subscribeWabaToApp).toHaveBeenCalled();
    expect(states().at(-1)).toBe("done");
  });

  it("does not mark done when the webhook subscription fails", async () => {
    // A registered number whose webhook is not subscribed receives messages at Meta that never
    // reach us — the worst state, because everything LOOKS connected.
    subscribeWabaToApp.mockRejectedValue(new Error("subscribe failed"));

    await run();

    expect(states().at(-1)).toBe("failed");
  });
});
