import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { assignNumberToAgent, CartesiaNotConfiguredError } from "./cartesiaAdmin.js";

/**
 * What this guards: a number with no agent behind it accepts the call and hangs up immediately.
 * The call never reaches our server, so nothing appears in our logs — the failure is invisible from
 * our side and looks like a broken phone line from the caller's.
 */
describe("assignNumberToAgent", () => {
  const original = { ...process.env };
  let requests: { url: string; method: string; body?: unknown; headers: Record<string, string> }[];

  function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      const { status = 200, body } = handler(url, init);
      requests.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(init.body as string) : undefined,
        headers: init.headers as Record<string, string>,
      });
      return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
    }) as unknown as typeof fetch;
  }

  const numbers = {
    data: [
      { id: "ap_1", number: "+972555077941", agent: null },
      { id: "ap_2", number: "+14155551234", agent: { id: "agent_other", name: "Other" } },
    ],
  };

  beforeEach(() => {
    requests = [];
    process.env.CARTESIA_API_KEY = "sk_car_test";
    process.env.CARTESIA_AGENT_ID = "agent_tori";
  });

  afterEach(() => {
    process.env = { ...original };
    vi.restoreAllMocks();
  });

  it("assigns an unassigned number to the shared agent", async () => {
    mockFetch(() => ({ body: numbers }));
    const result = await assignNumberToAgent("+972555077941");

    expect(result).toEqual({ changed: true, phoneNumberId: "ap_1" });
    const patch = requests.find((r) => r.method === "PATCH")!;
    expect(patch.url).toContain("/agents/phone-numbers/ap_1");
    expect(patch.body).toEqual({ agent_id: "agent_tori" });
  });

  it("matches a locally-written number against the E.164 one Cartesia stores", async () => {
    mockFetch(() => ({ body: numbers }));
    // The owner types the number the way they say it; Cartesia stores E.164.
    const result = await assignNumberToAgent("055-507-7941");
    expect(result.phoneNumberId).toBe("ap_1");
  });

  it("does nothing when the number already points at this agent", async () => {
    mockFetch(() => ({ body: { data: [{ id: "ap_1", number: "+972555077941", agent: { id: "agent_tori", name: "Tori" } }] } }));
    const result = await assignNumberToAgent("+972555077941");

    expect(result.changed).toBe(false);
    expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
  });

  it("reassigns a number currently pointed at a different agent", async () => {
    mockFetch(() => ({ body: numbers }));
    const result = await assignNumberToAgent("+14155551234");
    expect(result.changed).toBe(true);
  });

  it("says plainly when the number is absent and no trunk is configured to import it from", async () => {
    delete process.env.CARTESIA_SIP_PROVIDER_ID;
    mockFetch(() => ({ body: { data: [] } }));
    // Silently succeeding here would leave a salon with a line that never answers.
    await expect(assignNumberToAgent("+972500000000")).rejects.toThrow(/not in the Cartesia account/);
  });

  describe("when the number is absent and a SIP trunk is configured", () => {
    beforeEach(() => {
      process.env.CARTESIA_SIP_PROVIDER_ID = "ata_trunk";
    });

    function mockEmptyThenImport() {
      mockFetch((url, init) =>
        init.method === "POST"
          ? { body: { id: "ap_new", number: "+972500000000", agent: { id: "agent_tori", name: "Tori" } } }
          : { body: { data: [] } }
      );
    }

    it("imports the number over the trunk instead of failing onboarding", async () => {
      mockEmptyThenImport();
      const result = await assignNumberToAgent("+972500000000", { label: "מספרת רונית" });

      expect(result).toEqual({ changed: true, phoneNumberId: "ap_new", imported: true });
      const post = requests.find((r) => r.method === "POST")!;
      expect(post.url).toContain("/agents/phone-numbers");
      expect(post.body).toMatchObject({
        number: "+972500000000",
        provider: { id: "ata_trunk" },
        label: "מספרת רונית",
      });
    });

    it("assigns the agent in the import request, not a follow-up call", async () => {
      // Two calls would leave a window where the number is live with no agent behind it — a caller
      // in that window hears the line answer and hang up, which is the failure this module exists
      // to prevent.
      mockEmptyThenImport();
      await assignNumberToAgent("+972500000000");

      const post = requests.find((r) => r.method === "POST")!;
      expect(post.body).toMatchObject({ agent_id: "agent_tori" });
      expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
    });

    it("sends E.164, not the digits used for matching", async () => {
      mockEmptyThenImport();
      await assignNumberToAgent("050-000-0000");

      const post = requests.find((r) => r.method === "POST")!;
      expect((post.body as { number: string }).number).toBe("+972500000000");
    });

    it("refuses to import a number that was inferred rather than entered", async () => {
      // The WhatsApp connect flow guesses a voice number from the Meta line. That number is usually
      // not voice-capable, and importing it would put a line our carrier does not own onto our
      // trunk on a guess.
      mockFetch(() => ({ body: { data: [] } }));
      await expect(
        assignNumberToAgent("+972500000000", { importIfMissing: false })
      ).rejects.toThrow(/inferred rather than entered/);
      expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
    });
  });

  it("sends the pinned API version — omitting it changes the error format we parse", async () => {
    mockFetch(() => ({ body: numbers }));
    await assignNumberToAgent("+972555077941");
    expect(requests[0].headers["Cartesia-Version"]).toBe("2026-03-01");
    expect(requests[0].headers["Authorization"]).toBe("Bearer sk_car_test");
  });

  it("surfaces Cartesia's own explanation rather than a bare status code", async () => {
    mockFetch(() => ({ status: 403, body: { title: "Forbidden", message: "Admin key required." } }));
    await expect(assignNumberToAgent("+972555077941")).rejects.toThrow(/Forbidden: Admin key required/);
  });

  it("throws a distinguishable error when not configured, so it can be logged and not shown", async () => {
    delete process.env.CARTESIA_API_KEY;
    await expect(assignNumberToAgent("+972555077941")).rejects.toThrow(CartesiaNotConfiguredError);
  });
});
