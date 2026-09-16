import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash, createHmac } from "crypto";

/**
 * The carrier field that used to need a browser for every number.
 *
 * The setup doc asserted Zadarma had no API for it, which made connecting a salon's line a task
 * with a person in it. It does have one, and these pin the two things that make it work: the
 * signature recipe, which fails as a flat 401 that says nothing when any part of the order is
 * wrong, and the leading "+" on the SIP destination, whose absence drops calls before a call record
 * exists — so the number looks correctly configured on both sides while every call silently fails.
 */

const fetchMock = vi.fn();
const ENV = { ZADARMA_API_KEY: "user-key", ZADARMA_API_SECRET: "s3cret" };

beforeEach(() => {
  Object.assign(process.env, ENV);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(ENV)) delete process.env[k];
});

const { pointNumberAtCartesia, listNumbers, ZadarmaNotConfiguredError } = await import("./zadarmaAdmin.js");

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const numbersResponse = ok({ status: "success", info: [{ number: "972555077941", type: "direct" }] });

describe("pointNumberAtCartesia", () => {
  it("sets sip_id to the number in +E.164 at Cartesia's SIP host", async () => {
    fetchMock.mockResolvedValueOnce(numbersResponse).mockResolvedValueOnce(ok({ status: "success" }));
    const result = await pointNumberAtCartesia("+972555077941");

    expect(result.sipId).toBe("+972555077941@sip.cartesia.ai");
    const [, init] = fetchMock.mock.calls[1];
    const body = new URLSearchParams((init as RequestInit).body as string);
    // Without the leading "+", Cartesia's To-header match finds nothing and the call is dropped
    // before it becomes a call record — invisible on both sides.
    expect(body.get("sip_id")).toBe("+972555077941@sip.cartesia.ai");
    // The type comes from Zadarma's own listing; guessing it is rejected.
    expect(body.get("type")).toBe("direct");
    expect(body.get("number")).toBe("972555077941");
  });

  it("signs the request the way Zadarma specifies", async () => {
    fetchMock.mockResolvedValueOnce(numbersResponse).mockResolvedValueOnce(ok({ status: "success" }));
    await pointNumberAtCartesia("+972555077941");

    const [, init] = fetchMock.mock.calls[1];
    const path = "/v1/direct_numbers/set_sip_id/";
    // Sorted by key, urlencoded — then hashed with the path and the md5 of that same string.
    const query = new URLSearchParams([
      ["number", "972555077941"],
      ["sip_id", "+972555077941@sip.cartesia.ai"],
      ["type", "direct"],
    ]).toString();
    const md5 = createHash("md5").update(query).digest("hex");
    const expected = Buffer.from(
      createHmac("sha1", "s3cret").update(path + query + md5).digest("hex")
    ).toString("base64");

    expect((init as RequestInit).headers).toMatchObject({ Authorization: `user-key:${expected}` });
    expect((init as RequestInit).headers).toMatchObject({ "Content-Type": "application/x-www-form-urlencoded" });
  });

  it("matches the number however it was typed", async () => {
    // Owners type "055-507-7941"; Zadarma reports "972555077941". Neither side is wrong.
    fetchMock.mockResolvedValueOnce(numbersResponse).mockResolvedValueOnce(ok({ status: "success" }));
    await expect(pointNumberAtCartesia("+972-55-507-7941")).resolves.toMatchObject({ changed: true });
  });

  it("refuses a number this account does not hold, rather than configuring the wrong one", async () => {
    // Plenty of salons bring a number from another carrier — nothing here to configure for them.
    fetchMock.mockResolvedValueOnce(numbersResponse);
    await expect(pointNumberAtCartesia("+972500000000")).rejects.toThrow(/no number matching/i);
  });

  it("treats Zadarma's 200-with-error as a failure", async () => {
    // Zadarma answers HTTP 200 with {"status":"error"}, so the status code alone reports every
    // rejection as a success.
    fetchMock.mockResolvedValueOnce(numbersResponse).mockResolvedValueOnce(ok({ status: "error", message: "wrong type" }));
    await expect(pointNumberAtCartesia("+972555077941")).rejects.toThrow(/wrong type/);
  });

  it("names the missing variables instead of failing as an auth error", async () => {
    delete process.env.ZADARMA_API_KEY;
    await expect(listNumbers()).rejects.toThrow(ZadarmaNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * The renewal job runs on three things this client did not expose before: each number's stop date
 * and autorenew flag, and the two calls that change a line's future. Zadarma sends its booleans
 * as the strings "true"/"false" and its dates without a zone; both are pinned here.
 */
// Top-level, not inside the describe: a describe callback must be synchronous, and vitest
// refuses a file whose describe awaits.
const renewalMod = await import("./zadarmaAdmin.js");

describe("number expiry and renewal", () => {
  const mod = renewalMod;

  it("reads stop date, fee and autorenew off the number list", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        status: "success",
        info: [
          { number: "972559000001", type: "common", status: "on", stop_date: "2026-10-06 12:00:00", monthly_fee: 3, currency: "USD", autorenew: "true", is_on_test: "false" },
          { number: "972559000002", type: "common", status: "on", stop_date: "", monthly_fee: "2.5", currency: "USD", autorenew: "false", is_on_test: "false" },
        ],
      })
    );
    const [a, b] = await mod.listNumbers();
    expect(a.stopDate?.toISOString()).toBe("2026-10-06T12:00:00.000Z");
    expect(a.autorenew).toBe(true);
    expect(a.monthlyFee).toBe(3);
    expect(b.stopDate).toBeNull();
    expect(b.autorenew).toBe(false);
    expect(b.monthlyFee).toBe(2.5);
  });

  it("sets autorenew with the carrier's on/off vocabulary, digits only", async () => {
    fetchMock.mockResolvedValueOnce(ok({ status: "success", number: "972559000001", autoprolongation: "off" }));
    await mod.setAutoprolongation("+972 55-900-0001", false);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v1/direct_numbers/autoprolongation/");
    expect(init.method).toBe("PUT");
    expect(String(init.body)).toBe("number=972559000001&value=off");
  });

  it("prepays and returns the new stop date and what was charged", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ status: "success", number: "972559000001", stop_date: "2026-11-06 12:00:00", total_paid: { amount: 3, currency: "USD" } })
    );
    const r = await mod.prolongNumber("972559000001", 1);
    expect(r).toEqual({ stopDate: new Date("2026-11-06T12:00:00.000Z"), totalPaid: 3, currency: "USD" });
    expect(String(fetchMock.mock.calls[0][1].body)).toBe("months=1&number=972559000001");
  });

  it("surfaces the carrier's own error text — it answers 200 with status:error", async () => {
    fetchMock.mockResolvedValueOnce(ok({ status: "error", message: "Not enough money" }));
    await expect(mod.prolongNumber("972559000001", 1)).rejects.toThrow("Not enough money");
  });
});
