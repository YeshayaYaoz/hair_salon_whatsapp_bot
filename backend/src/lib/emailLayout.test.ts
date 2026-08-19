import { describe, it, expect } from "vitest";
import { esc, linkifyPhones } from "./emailLayout.js";

/**
 * The owner alert that prompted this carried "לחזור אליו: +972506747354" as plain text — nothing to
 * tap on a phone, for a message whose whole purpose is to return a call.
 *
 * The risk in fixing it is the opposite failure: over-matching, and turning a date or a price into
 * a broken tel: link. Both directions are covered here.
 */
describe("linkifyPhones", () => {
  const href = (html: string) => html.match(/href="tel:([^"]+)"/)?.[1] ?? null;

  it("links an international number and dials the digits only", () => {
    const out = linkifyPhones("לחזור אליו: +972506747354");
    expect(href(out)).toBe("+972506747354");
    // The visible text keeps the original formatting.
    expect(out).toContain(">+972506747354</a>");
  });

  it("links a local Israeli mobile", () => {
    expect(href(linkifyPhones("0506747354"))).toBe("0506747354");
  });

  it("links a number written with separators, but dials it without them", () => {
    expect(href(linkifyPhones("050-674-7354"))).toBe("0506747354");
    expect(href(linkifyPhones("050 674 7354"))).toBe("0506747354");
  });

  it("leaves an ISO date alone", () => {
    const out = linkifyPhones("התור נקבע ל-2026-08-19 בשעה 09:30");
    expect(out).not.toContain("tel:");
  });

  it("leaves prices and short numbers alone", () => {
    expect(linkifyPhones("המחיר הוא 449 שקלים")).not.toContain("tel:");
    expect(linkifyPhones("1,284 תורים")).not.toContain("tel:");
  });

  it("leaves a long digit string that is not a plausible phone alone", () => {
    // 8 digits, no leading zero, not international.
    expect(linkifyPhones("מזהה 20260819")).not.toContain("tel:");
  });

  it("links every number when a message carries more than one", () => {
    const out = linkifyPhones("דנה 0501111111, יוסי 0502222222");
    expect(out.match(/href="tel:/g)).toHaveLength(2);
  });

  it("does not resurrect markup that esc() neutralised", () => {
    // Runs on escaped input, so an injection attempt stays inert and is not re-enabled by the
    // anchors this adds.
    const out = linkifyPhones(esc('<img src=x onerror=alert(1)> 0506747354'));
    expect(out).toContain("&lt;img");
    expect(out).not.toContain("<img");
    expect(href(out)).toBe("0506747354");
  });

  it("keeps newlines intact so callers can still convert them to <br/>", () => {
    const out = linkifyPhones("שורה\n0506747354");
    expect(out).toContain("\n");
  });
});
