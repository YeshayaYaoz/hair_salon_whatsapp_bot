import { describe, it, expect, vi } from "vitest";

// paymentWebhooks.js pulls in lib/prisma, which builds a real PrismaClient at import time and
// throws without DATABASE_URL. The parsers under test are pure, so the suite would otherwise pass
// or fail on whether the machine running it happens to have a .env.
vi.mock("../lib/prisma.js", () => ({ prisma: {} }));

const { PARSERS } = await import("./paymentWebhooks.js");

/**
 * Pins each provider's callback parser to the payload its documentation shows.
 *
 * The Grow and Cardcom examples encode bugs that shipped: Grow's cField1 arrives under
 * data.customFields (not data.pageField, which is only the REQUEST field's name) and the phone
 * under payerPhone; Cardcom's amount and payer live inside TranzactionInfo — there is no
 * top-level Amount in LowProfileResult, so the amount floor rejected every real payment.
 */

describe("grow callback parser", () => {
  // From Grow's docs, "Server-to-Server Callback" — form-encoded, so every value is a string.
  const documented = {
    err: "",
    status: "1",
    data: {
      status: "שולם", statusCode: "2", sum: "100",
      fullName: "ישראל ישראלי", payerPhone: "0500000000",
      transactionId: "421100", processId: "512895",
      customFields: { cField1: "appt-77" },
    },
  };

  it("reads the documented shape: string status, customFields.cField1, payerPhone", () => {
    const e = PARSERS.grow(documented as never);
    expect(e).toMatchObject({
      success: true, amountIls: 100, referenceId: "appt-77",
      customerName: "ישראל ישראלי", customerPhone: "0500000000",
    });
  });

  it("still accepts the request-shaped echo some integrations report (pageField)", () => {
    const e = PARSERS.grow({ status: "1", data: { sum: "50", pageField: { cField1: "appt-1" } } } as never);
    expect(e.referenceId).toBe("appt-1");
  });

  it("a failed status is not success", () => {
    expect(PARSERS.grow({ status: "0", err: { message: "x" }, data: {} } as never).success).toBe(false);
  });
});

describe("cardcom callback parser", () => {
  // LowProfileResult per Cardcom's v11 swagger: money and payer inside TranzactionInfo.
  const documented = {
    ResponseCode: 0, Description: "OK", TerminalNumber: 1000,
    LowProfileId: "lp-1", TranzactionId: 555, ReturnValue: "appt-42",
    TranzactionInfo: { ResponseCode: 0, Amount: 80, CardOwnerName: "דנה לוי", CardOwnerPhone: "0521111111" },
    UIValues: { CardOwnerName: "דנה לוי" },
  };

  it("reads amount and payer from TranzactionInfo", () => {
    const e = PARSERS.cardcom(documented as never);
    expect(e).toMatchObject({
      success: true, amountIls: 80, referenceId: "appt-42",
      customerName: "דנה לוי", customerPhone: "0521111111",
    });
  });

  it("a non-zero ResponseCode is not success", () => {
    expect(PARSERS.cardcom({ ...documented, ResponseCode: 605 } as never).success).toBe(false);
  });
});

describe("ypay callback parser", () => {
  // Their API doc v1.9, "Transaction Information": this is the whole payload. Note what is NOT in
  // it — nothing echoes back the chargeIdentifier we sent, which is why lib/payments/ypay.ts puts
  // the reference in the notifyUrl query and the route reads it from there.
  const documented = {
    success: "true",
    transactionId: "918273",
    url: "https://ypay.co.il/doc/918273.pdf",
    sum: "80",
    document_id: "900061",
    document_type: "108",
  };

  it("reads the amount and the receipt YPAY issued during clearing", () => {
    const e = PARSERS.ypay(documented as never);
    expect(e).toMatchObject({ success: true, amountIls: 80, receiptUrl: "https://ypay.co.il/doc/918273.pdf" });
  });

  it("carries no referenceId of its own — the route supplies it from the notify URL", () => {
    expect(PARSERS.ypay(documented as never).referenceId).toBeUndefined();
  });

  it("accepts the documented string as well as a real boolean", () => {
    expect(PARSERS.ypay({ ...documented, success: true } as never).success).toBe(true);
  });

  it("a failed transaction is not success", () => {
    expect(PARSERS.ypay({ success: "false", transactionId: "0" } as never).success).toBe(false);
  });
});
