import { describe, it, expect } from "vitest";
import { explainPayPlusError } from "./payplusErrors.js";

/**
 * Each of these needs a different fix — a call to PayPlus, a field in our dashboard, or a wrong
 * key — so the point of the mapping is that the owner can tell them apart.
 */
describe("explainPayPlusError", () => {
  it("explains the recurring-payments permission, which only PayPlus can enable", () => {
    const out = explainPayPlusError("PayPlus generateLink failed (422): dont-have-permission-recurring-payment");
    expect(out).toContain("חיובים חוזרים");
    expect(out).toContain("לפנות אליהם");
  });

  it("explains a missing payment page uid", () => {
    expect(explainPayPlusError("(405): not-authorize-missing-payment-page-uid")).toContain("דף התשלום");
  });

  it("points at sandbox-vs-production when the keys are rejected", () => {
    expect(explainPayPlusError("invalid api key")).toContain("sandbox");
  });

  it("keeps the original code so it can be quoted to support", () => {
    expect(explainPayPlusError("dont-have-permission-recurring-payment")).toContain(
      "dont-have-permission-recurring-payment"
    );
  });

  it("passes an unrecognised error through untouched", () => {
    expect(explainPayPlusError("some-brand-new-code-nobody-mapped")).toBe("some-brand-new-code-nobody-mapped");
  });

  it("prefers the more specific page-uid message over the generic not-authorize one", () => {
    // The raw string contains "not-authorize", which the credentials rule also matches — order in
    // the table is what keeps this from telling the owner to check their API keys.
    expect(explainPayPlusError("not-authorize-missing-payment-page-uid")).toContain("דף התשלום");
  });
});
