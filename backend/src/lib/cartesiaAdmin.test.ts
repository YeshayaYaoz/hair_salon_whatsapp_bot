import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { assignNumberToAgent, listHebrewVoices, resetVoiceCache, CartesiaNotConfiguredError } from "./cartesiaAdmin.js";

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

  /**
   * One shared agent answers for every salon, so the voice is the only thing that makes two
   * businesses sound different. The catalogue this picks from is Cartesia's, not ours.
   */
  describe("listHebrewVoices", () => {
    const catalogue = {
      data: [
        { id: "v_he", name: "Noa", language: "he", gender: "feminine", preview_file_url: "https://s/1.wav" },
        { id: "v_he_regional", name: "Yossi", language: "en", gender: "masculine", locales: [{ locale: "he-IL", is_native: false }] },
        { id: "v_en", name: "Sarah", language: "en", gender: "feminine", locales: [{ locale: "en-US", is_native: true }] },
      ],
    };

    beforeEach(() => {
      resetVoiceCache();
    });

  // Two voice agents exist, one masculine and one feminine, each fixed to its own gender at deploy
  // time. Offering the full Hebrew catalogue let a salon pick a third voice that would then speak
  // the wrong gender's verbs, because the dialled number routes to one of those two agents anyway.
    // Two voice agents exist, one masculine and one feminine, each fixed to its own gender at
    // deploy time. Offering the full Hebrew catalogue let a salon pick a third voice that would
    // then speak the wrong gender's verbs, because the dialled number routes to one of those two
    // agents regardless of which voice was chosen.
    describe("TORI_VOICE_IDS restriction", () => {
      beforeEach(() => {
        delete process.env.TORI_VOICE_IDS;
        mockFetch(() => ({ body: catalogue }));
      });

      it("offers only the configured voices", async () => {
        process.env.TORI_VOICE_IDS = "v_he, v_he_regional";
        expect((await listHebrewVoices()).map((v) => v.id)).toEqual(["v_he", "v_he_regional"]);
      });

      it("drops a voice that is not offered", async () => {
        process.env.TORI_VOICE_IDS = "v_he";
        expect((await listHebrewVoices()).map((v) => v.id)).toEqual(["v_he"]);
      });

      it("offers the whole catalogue when unset, so an unconfigured deployment is unaffected", async () => {
        expect((await listHebrewVoices()).length).toBeGreaterThan(1);
      });
    });

    it("keeps only the voices that can actually speak Hebrew", async () => {
      mockFetch(() => ({ body: catalogue }));
      const voices = await listHebrewVoices();
      expect(voices.map((v) => v.id)).toEqual(["v_he", "v_he_regional"]);
    });

    // Listing voices needs the API key and nothing else. Requiring an agent id here meant an
    // account that had not configured one got an empty picker and, because /context reads the
    // agent's grammatical gender off this catalogue, a voice agent stuck in the feminine.
    it("works without CARTESIA_AGENT_ID, which listing voices does not need", async () => {
      delete process.env.CARTESIA_AGENT_ID;
      mockFetch(() => ({ body: catalogue }));
      expect((await listHebrewVoices()).map((v) => v.id)).toEqual(["v_he", "v_he_regional"]);
      process.env.CARTESIA_AGENT_ID = "agent_tori";
    });

    it("returns nothing, rather than throwing, when there is no API key", async () => {
      const key = process.env.CARTESIA_API_KEY;
      delete process.env.CARTESIA_API_KEY;
      expect(await listHebrewVoices()).toEqual([]);
      process.env.CARTESIA_API_KEY = key;
    });

    it("counts a region-tagged locale as Hebrew", async () => {
      // The tags are BCP-47, so an exact "he" match would drop every he-IL voice.
      mockFetch(() => ({ body: catalogue }));
      const voices = await listHebrewVoices();
      expect(voices.some((v) => v.id === "v_he_regional")).toBe(true);
    });

    it("asks for preview URLs, without which the picker cannot play a sample", async () => {
      mockFetch(() => ({ body: catalogue }));
      await listHebrewVoices();
      expect(requests[0].url).toContain("expand[]=preview_file_url");
      expect(await listHebrewVoices().then((v) => v[0].previewUrl)).toBe("https://s/1.wav");
    });

    it("fetches the catalogue once and reuses it", async () => {
      // Otherwise every visit to the bot settings page puts a third-party call on the critical path.
      mockFetch(() => ({ body: catalogue }));
      await listHebrewVoices();
      await listHebrewVoices();
      expect(requests).toHaveLength(1);
    });

    it("degrades to no choices rather than breaking the settings page", async () => {
      // Voice selection is optional; a settings page that fails to load because Cartesia is down is
      // a worse outcome than one that says the choice is unavailable.
      mockFetch(() => ({ status: 500, body: { message: "boom" } }));
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await expect(listHebrewVoices()).resolves.toEqual([]);
    });

    it("returns nothing rather than throwing when Cartesia is not configured", async () => {
      delete process.env.CARTESIA_API_KEY;
      await expect(listHebrewVoices()).resolves.toEqual([]);
    });
  });
});
