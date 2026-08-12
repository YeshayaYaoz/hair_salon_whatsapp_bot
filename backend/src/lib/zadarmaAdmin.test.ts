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
