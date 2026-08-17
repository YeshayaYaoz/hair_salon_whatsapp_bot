import { describe, it, expect } from "vitest";
import {
  ALL_WORDINGS,
  OWNER_ALERT_TEXT,
  OUTREACH_TEMPLATE_BODY,
  OUTREACH_TEMPLATE_EXAMPLE,
  wordingFor,
} from "./whatsappTemplates.js";

/**
 * Every body here is submitted to Meta for review, and Meta's rejection rules are mechanical.
 *
 * A rejected template is invisible from inside the product: sending falls back to free-form, which
 * works right up until the customer's 24h window closes, and then the message is simply never
 * delivered with no error anyone sees. The review body used to open with "{{1}}" — a dangling
 * parameter, an automatic rejection — and nothing in the codebase would have noticed.
 */

/**
 * Every variant, not only the default. A second wording is exactly the kind of addition that gets
 * these rules right in the copy that was reviewed and wrong in the one that was not — and the
 * failure is invisible until Meta rejects it days later.
 */
const BODIES: Array<[string, string, string[]]> = [
  ...ALL_WORDINGS.flatMap(([wording, w]): Array<[string, string, string[]]> => [
    [`${wording} reminder`, w.reminder.body, w.reminder.example],
    [`${wording} review`, w.review.body, w.review.example],
    [`${wording} confirmation`, w.confirmation.body, w.confirmation.example],
  ]),
  ["owner alert", OWNER_ALERT_TEXT.body, OWNER_ALERT_TEXT.example],
  ["outreach", OUTREACH_TEMPLATE_BODY, OUTREACH_TEMPLATE_EXAMPLE],
];

describe.each(BODIES)("the %s template body is submittable", (_name, body, example) => {
  it("has one example value per variable", () => {
    // Meta rejects a template with variables and no examples — which is what happened to every
    // template submitted before this, all four of them.
    const count = new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])).size;
    expect(example).toHaveLength(count);
  });

  it("does not start or end with a parameter, punctuation included", () => {
    // Meta calls this a dangling parameter and rejects it outright — and counts a trailing "." as
    // punctuation rather than as text, so "…ב{{3}}." is still dangling. Checking the raw ends let
    // exactly that body through, and Meta answered "Variables can't be at the start or end of the
    // template."
    const core = body.replace(/^[\s.,!?—–-]+/u, "").replace(/[\s.,!?—–-]+$/u, "");
    expect(core.startsWith("{{")).toBe(false);
    expect(core.endsWith("}}")).toBe(false);
  });

  it("numbers its parameters from 1 with no gaps", () => {
    const nums = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    expect(nums).toEqual([...new Set(nums)].sort((a, b) => a - b));
    if (nums.length) expect(nums).toEqual(nums.map((_, i) => i + 1));
  });

  it("never places two parameters back to back", () => {
    expect(/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body)).toBe(false);
  });
});

describe("wordingFor", () => {
  it("gives a zimmer bookings and guests, not appointments", () => {
    const w = wordingFor("bnb");
    expect(w.confirmation.body).toContain("ההזמנה");
    expect(w.confirmation.body).not.toContain("התור");
    expect(w.review.body).toContain("התארחתם");
  });

  it("gives a salon appointments", () => {
    expect(wordingFor("salon").confirmation.body).toContain("התור");
  });

  it("falls back to appointments for an unknown or unset type", () => {
    // Generic Hebrew still delivers; no template at all delivers nothing.
    expect(wordingFor(null).confirmation.body).toContain("התור");
    expect(wordingFor("something-new").confirmation.body).toContain("התור");
  });

  it("keeps the variable order identical across variants", () => {
    // The sending code passes positional parameters and knows nothing about wording. A variant
    // that reordered them would put the guest's name where the date belongs.
    const order = (b: string) => [...b.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]).join(",");
    for (const [, w] of ALL_WORDINGS) {
      expect(order(w.confirmation.body)).toBe("1,2,3,4");
      expect(order(w.reminder.body)).toBe("1,2,3,4");
      expect(order(w.review.body)).toBe("1,2,3");
    }
  });
});
