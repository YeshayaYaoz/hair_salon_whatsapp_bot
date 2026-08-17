import { describe, it, expect, vi, afterEach } from "vitest";
import { describeProblem, checkWhatsAppLines } from "./whatsappLineHealth.js";

describe("describeProblem", () => {
  it("says nothing about a healthy line", () => {
    expect(
      describeProblem({ display_phone_number: "+972 55-507-7941", verified_name: "צימר", status: "CONNECTED", quality_rating: "GREEN" })
    ).toBeNull();
  });

  it("catches a business still on Meta's sample number", () => {
    // The real case that prompted this: a business looked fully connected — CONNECTED, GREEN — and
    // was sending from the +1 555 number every new app ships with, which no Israeli customer can be
    // reached on. Every other signal said healthy.
    const problem = describeProblem({
      display_phone_number: "+1 555-055-2938",
      verified_name: "Test Number",
      status: "CONNECTED",
      quality_rating: "GREEN",
    });
    expect(problem).toMatch(/test number/i);
  });

  it("catches a line Meta moved out of CONNECTED", () => {
    expect(describeProblem({ status: "PENDING", quality_rating: "GREEN" })).toMatch(/PENDING/);
  });

  it("warns at YELLOW, not only once throttling has started", () => {
    expect(describeProblem({ status: "CONNECTED", quality_rating: "YELLOW" })).toMatch(/YELLOW/);
    expect(describeProblem({ status: "CONNECTED", quality_rating: "RED" })).toMatch(/RED/);
  });

  it("does not invent a problem from an answer missing fields", () => {
    expect(describeProblem({})).toBeNull();
  });
});

describe("checkWhatsAppLines", () => {
  afterEach(() => vi.unstubAllGlobals());

  const ok = { display_phone_number: "+972 1", verified_name: "Fine", status: "CONNECTED", quality_rating: "GREEN" };

  it("reports only the businesses with something wrong", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      new Response(JSON.stringify(String(url).includes("/bad") ? { ...ok, status: "FLAGGED" } : ok))
    ));

    const problems = await checkWhatsAppLines([
      { name: "Healthy", phoneNumberId: "good", accessToken: "t" },
      { name: "Sick", phoneNumberId: "bad", accessToken: "t" },
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0].business).toBe("Sick");
  });

  it("surfaces a rejected token as the problem it is", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "Session has expired" } }))
    ));

    const [problem] = await checkWhatsAppLines([{ name: "Expired", phoneNumberId: "x", accessToken: "t" }]);
    expect(problem.problem).toMatch(/Session has expired/);
  });

  it("keeps checking the others when one business's call throws", async () => {
    // One broken business must not cost the digest every other business's result.
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/explodes")) throw new Error("socket hang up");
      return new Response(JSON.stringify(ok));
    }));

    const problems = await checkWhatsAppLines([
      { name: "Boom", phoneNumberId: "explodes", accessToken: "t" },
      { name: "Healthy", phoneNumberId: "good", accessToken: "t" },
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0].business).toBe("Boom");
    expect(problems[0].problem).toMatch(/socket hang up/);
  });
});
