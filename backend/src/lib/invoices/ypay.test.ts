import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ypayProvider, __clearYpayTokenCache } from "./ypay.js";

const creds = { apiKey: "client-1", apiSecret: "secret-1" };
const params = {
  amountIls: 120,
  description: "מקדמה עבור תספורת",
  customerName: "דנה כהן",
  customerPhone: "0501234567",
};

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
const tokenOk = () => jsonRes({ access_token: "t".repeat(64), lifetime: 3_600_000 });
const docOk = () => jsonRes({ url: "https://ypay.co.il/doc/1.pdf", serial_number: 900061, responseCode: 1 });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  __clearYpayTokenCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body as string);
const urlOf = (call: number) => fetchMock.mock.calls[call][0] as string;

describe("ypay createReceipt", () => {
  it("authenticates, then issues a receipt", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(docOk());
    const out = await ypayProvider.createReceipt(creds, params);
    expect(out).toEqual({ documentUrl: "https://ypay.co.il/doc/1.pdf", providerDocumentId: "900061" });

    expect(urlOf(0)).toContain("/accessToken");
    expect(bodyOf(0)).toEqual({ client_id: "client-1", client_secret: "secret-1" });
    expect(urlOf(1)).toContain("/document");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${"t".repeat(64)}`);
  });

  it("issues a קבלה whose item total equals its payment-method total", async () => {
    // Their error 3022 rejects a document whose two totals disagree, so this is the invariant
    // that keeps every receipt issuable rather than a styling preference.
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(docOk());
    await ypayProvider.createReceipt(creds, params);
    const doc = bodyOf(1);
    expect(doc.docType).toBe(108);
    expect(doc.items[0].price * doc.items[0].quantity).toBe(doc.methods[0].total);
    expect(doc.methods[0].total).toBe(120);
    // The amount handed in is what the customer paid, VAT included — marking this false would
    // have YPAY add VAT on top and issue a receipt for more than was charged.
    expect(doc.items[0].vatIncluded).toBe(true);
  });

  it("reuses a cached token instead of re-authenticating", async () => {
    // Error 2002 makes a second token request while one is live an ERROR, not a refresh — so a
    // salon's second receipt of the hour is exactly what a per-call token would break.
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(docOk())
      .mockResolvedValueOnce(docOk());
    await ypayProvider.createReceipt(creds, params);
    await ypayProvider.createReceipt(creds, params);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/accessToken"))).toHaveLength(1);
  });

  it("re-authenticates once the cached token has expired", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ access_token: "short", lifetime: 1 })) // already past the margin
      .mockResolvedValueOnce(docOk())
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(docOk());
    await ypayProvider.createReceipt(creds, params);
    await ypayProvider.createReceipt(creds, params);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/accessToken"))).toHaveLength(2);
  });

  it("uses the real email and mails the document when one is known", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(docOk());
    await ypayProvider.createReceipt(creds, { ...params, customerEmail: "dana@example.com" });
    const doc = bodyOf(1);
    expect(doc.contact.email).toBe("dana@example.com");
    expect(doc.mail).toBe(true);
  });

  it("derives a per-customer placeholder when no email is known, and mails nothing", async () => {
    // YPAY keys contacts on email+businessID, so a single shared dummy would merge every
    // phone-only customer into one contact record in the salon's books.
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(docOk());
    await ypayProvider.createReceipt(creds, params);
    const doc = bodyOf(1);
    expect(doc.contact.email).toBe("0501234567@no-reply.invalid");
    expect(doc.mail).toBe(false);
  });

  it("gives two different customers two different placeholder contacts", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(docOk())
      .mockResolvedValueOnce(docOk());
    await ypayProvider.createReceipt(creds, params);
    await ypayProvider.createReceipt(creds, { ...params, customerPhone: "0527654321" });
    expect(bodyOf(1).contact.email).not.toBe(bodyOf(2).contact.email);
  });

  it("refuses when it has neither an email nor a phone", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk());
    await expect(
      ypayProvider.createReceipt(creds, { ...params, customerPhone: undefined })
    ).rejects.toThrow(/email or phone/i);
  });

  it("throws on a rejected document rather than returning a half result", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(jsonRes({ responseCode: 0, errorCode: 3022, message: "Total items price not equal" }));
    await expect(ypayProvider.createReceipt(creds, params)).rejects.toThrow(/3022/);
  });

  it("reports bad credentials clearly", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ errorCode: 2001, message: "Bad client ID or client secret" }));
    await expect(ypayProvider.createReceipt(creds, params)).rejects.toThrow(/Bad client ID/);
  });
});

describe("ypay verifyCredentials", () => {
  it("accepts credentials that mint a token", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk());
    expect(await ypayProvider.verifyCredentials(creds)).toEqual({ valid: true });
  });

  it("keeps the token it just minted, so the next call does not trip 2002", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(docOk());
    await ypayProvider.verifyCredentials(creds);
    await ypayProvider.createReceipt(creds, params);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/accessToken"))).toHaveLength(1);
  });

  it("treats 'a token is already active' as valid, not invalid", async () => {
    // Only working credentials can have a live token. Reporting this as invalid would tell an
    // owner their correct keys were wrong — and the more recently they had used them, the more
    // likely they would see it.
    fetchMock.mockResolvedValueOnce(jsonRes({ errorCode: 2002, message: "There is already an active token" }));
    expect(await ypayProvider.verifyCredentials(creds)).toEqual({ valid: true });
  });

  it("rejects wrong credentials", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ errorCode: 2001, message: "Bad client ID or client secret" }));
    const out = await ypayProvider.verifyCredentials(creds);
    expect(out.valid).toBe(false);
    expect(out.error).toMatch(/Bad client ID/);
  });

  it("reports a network failure instead of throwing", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const out = await ypayProvider.verifyCredentials(creds);
    expect(out.valid).toBe(false);
    expect(out.error).toBe("ECONNRESET");
  });
});
