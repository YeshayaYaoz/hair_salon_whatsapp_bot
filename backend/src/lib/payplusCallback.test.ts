import { describe, it, expect } from "vitest";
import { parsePayPlusCallback } from "./payplusCallback.js";

/**
 * Pins the parser against the two payload shapes PayPlus actually sends.
 *
 * The nested one is copied from their documentation's "Transaction Callback Response" example.
 * Both webhooks previously read only the flat shape — a documented-shape callback computed
 * success=false, was acknowledged with 200, and the paid subscription/deposit never activated,
 * with no retry from PayPlus and nothing in our logs.
 */

// Verbatim structure from docs.payplus.co.il (values shortened).
const DOCUMENTED_NESTED = {
  results: { status: "success", code: 0, description: "operation has been success" },
  data: {
    transaction: {
      uid: "599dbe80-53bf-4e2b-9f66-e38d42b90b68",
      number: "ha635",
      type: "internal_page",
      status_code: "000",
      amount: 90,
      currency: "ILS",
      more_info: "ref-abc123",
      approval_number: "0000000",
    },
    data: {
      customer_uid: "ef76432c-769a-43a6-ba7a-6f70272539d8",
      terminal_uid: "97432e96-3c21-4eb2-9d64-1067e845b35a",
      card_information: { four_digits: "0218", token_uid: "tok-nested-1" },
    },
  },
};

const FLAT = {
  transaction_uid: "e067c092",
  status_code: "000",
  amount: 149,
  more_info: "ref-flat",
  token_uid: "tok-flat-1",
  customer_name: "דנה לוי",
  phone: "0521234567",
};

describe("parsePayPlusCallback", () => {
  it("reads the documented nested shape — status, amount and reference under data.transaction", () => {
    const e = parsePayPlusCallback(DOCUMENTED_NESTED);
    expect(e.success).toBe(true);
    expect(e.amountIls).toBe(90);
    expect(e.referenceId).toBe("ref-abc123");
    expect(e.tokenUid).toBe("tok-nested-1");
  });

  it("reads the flat shape older integrations receive", () => {
    const e = parsePayPlusCallback(FLAT);
    expect(e).toMatchObject({
      success: true,
      amountIls: 149,
      referenceId: "ref-flat",
      tokenUid: "tok-flat-1",
      customerName: "דנה לוי",
      customerPhone: "0521234567",
    });
  });

  it("a failed charge is not success in either shape", () => {
    expect(parsePayPlusCallback({ ...FLAT, status_code: "154" }).success).toBe(false);
    const nested = structuredClone(DOCUMENTED_NESTED);
    nested.data.transaction.status_code = "003";
    expect(parsePayPlusCallback(nested).success).toBe(false);
  });

  it("prefers the shallow field when a deeper duplicate exists", () => {
    // amount at the transaction level is the charge; a nested items[].amount is a line item.
    const e = parsePayPlusCallback({
      status_code: "000",
      amount: 149,
      data: { items: [{ amount: 1 }] },
    });
    expect(e.amountIls).toBe(149);
  });

  it("survives junk without spinning or throwing", () => {
    expect(parsePayPlusCallback(null).success).toBe(false);
    expect(parsePayPlusCallback("nonsense").success).toBe(false);
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 500; i++) cursor = (cursor.next = {}) as Record<string, unknown>;
    expect(parsePayPlusCallback(deep).success).toBe(false);
  });
});
