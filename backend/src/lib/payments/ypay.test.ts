import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ypayPaymentProvider } from "./ypay.js";
import { ypayProvider as ypayInvoiceProvider } from "../invoices/ypay.js";
import { __clearYpayTokenCache } from "../ypayAuth.js";

const creds = { apiKey: "client-1", apiSecret: "secret-1" };
const params = {
  amountIls: 80,
  description: "מקדמה עבור תספורת",
  customerName: "דנה כהן",
  customerPhone: "0501234567",
  referenceId: "appt_abc123",
  callbackUrl: "https://api.tori.test/webhook/payments/ypay/biz1/s3cr3t",
};

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
const tokenOk = () => jsonRes({ access_token: "t".repeat(64), lifetime: 3_600_000 });
const pageOk = () => jsonRes({ url: "https://app.upay.co.il/BANKRESOURCES/UPAY/redirectpages/x.html", responseCode: 1 });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  __clearYpayTokenCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body as string);
const urlOf = (call: number) => fetchMock.mock.calls[call][0] as string;

describe("ypay createPaymentLink", () => {
  it("authenticates, then returns the hosted payment page", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(pageOk());
    const out = await ypayPaymentProvider.createPaymentLink(creds, params);

    expect(out.paymentUrl).toContain("app.upay.co.il");
    // No transaction exists until somebody pays, so our own reference is the handle for the
    // attempt — and it is what the callback is correlated by anyway.
    expect(out.providerTransactionId).toBe("appt_abc123");
    expect(urlOf(0)).toContain("/accessToken");
    expect(urlOf(1)).toContain("/payment");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${"t".repeat(64)}`);
  });

  it("carries the reference in notifyUrl, because their callback body has none", async () => {
    // Their documented notify payload is success/transactionId/url/sum/document_id/document_type —
    // nothing echoes chargeIdentifier back. Without this the deposit could never be matched to its
    // appointment, and a paid customer would sit on an unconfirmed booking.
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(pageOk());
    await ypayPaymentProvider.createPaymentLink(creds, params);
    const body = bodyOf(1);
    expect(body.notifyUrl).toBe(`${params.callbackUrl}?ref=appt_abc123`);
    expect(body.chargeIdentifier).toBe("appt_abc123");
  });

  it("asks for a receipt, which is also what makes the amount arrive on the callback", async () => {
    // docType 0 would leave receipts to the invoice provider — but their doc scopes `sum` to
    // "docType different than 'none'", and the deposit check cannot pass without an amount.
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(pageOk());
    await ypayPaymentProvider.createPaymentLink(creds, params);
    const body = bodyOf(1);
    expect(body.docType).toBe(108);
    expect(body.items[0].price).toBe(80);
    expect(body.items[0].vatIncluded).toBe(true);
    // A catalogue entry per booking is what sending `name` would file in the salon's item index.
    expect(body.items[0]).not.toHaveProperty("name");
  });

  it("sends one payment, not their default of twelve", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(pageOk());
    await ypayPaymentProvider.createPaymentLink(creds, params);
    expect(bodyOf(1).payments).toBe(1);
  });

  it("derives a per-customer placeholder email, and mails nothing to it", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(pageOk());
    await ypayPaymentProvider.createPaymentLink(creds, params);
    const body = bodyOf(1);
    expect(body.contact.email).toBe("0501234567@no-reply.invalid");
    expect(body.mail).toBe(false);
  });

  it("throws on a rejected request rather than returning a dead link", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(jsonRes({ responseCode: 0, errorCode: 4002, message: "UPAY LOGIN error" }));
    await expect(ypayPaymentProvider.createPaymentLink(creds, params)).rejects.toThrow(/4002/);
  });
});

describe("ypay verifyCredentials", () => {
  it("accepts credentials that mint a token, without leaving a transaction behind", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk());
    expect(await ypayPaymentProvider.verifyCredentials(creds)).toEqual({ valid: true });
    expect(urlOf(0)).toContain("/accessToken");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats 'a token is already active' as valid, not invalid", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ errorCode: 2002, message: "There is already an active token" }));
    expect(await ypayPaymentProvider.verifyCredentials(creds)).toEqual({ valid: true });
  });

  it("rejects wrong credentials", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ errorCode: 2001, message: "Bad client ID or client secret" }));
    const out = await ypayPaymentProvider.verifyCredentials(creds);
    expect(out.valid).toBe(false);
  });
});

describe("one YPAY account, two adapters", () => {
  it("shares the token between clearing and invoicing", async () => {
    // A salon using YPAY for both holds ONE client_id. Error 2002 makes a second token request
    // while one is live an error, so separate caches would mean whichever adapter ran second was
    // refused for the rest of the hour.
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(pageOk())
      .mockResolvedValueOnce(jsonRes({ url: "https://ypay.co.il/doc/1.pdf", serial_number: 1, responseCode: 1 }));

    await ypayPaymentProvider.createPaymentLink(creds, params);
    await ypayInvoiceProvider.createReceipt(creds, {
      amountIls: 80,
      description: "תספורת",
      customerName: "דנה כהן",
      customerPhone: "0501234567",
    });

    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/accessToken"))).toHaveLength(1);
  });
});
