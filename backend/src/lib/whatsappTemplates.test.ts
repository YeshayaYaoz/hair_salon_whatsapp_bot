import { describe, it, expect } from "vitest";
import {
  REMINDER_TEMPLATE_BODY,
  REVIEW_TEMPLATE_BODY,
  CONFIRMATION_TEMPLATE_BODY,
  OWNER_ALERT_TEMPLATE_BODY,
} from "./whatsappTemplates.js";

/**
 * Every body here is submitted to Meta for review, and Meta's rejection rules are mechanical.
 *
 * A rejected template is invisible from inside the product: sending falls back to free-form, which
 * works right up until the customer's 24h window closes, and then the message is simply never
 * delivered with no error anyone sees. The review body used to open with "{{1}}" — a dangling
 * parameter, an automatic rejection — and nothing in the codebase would have noticed.
 */

const BODIES: Array<[string, string]> = [
  ["reminder", REMINDER_TEMPLATE_BODY],
  ["review", REVIEW_TEMPLATE_BODY],
  ["confirmation", CONFIRMATION_TEMPLATE_BODY],
  ["owner alert", OWNER_ALERT_TEMPLATE_BODY],
];

describe.each(BODIES)("the %s template body is submittable", (_name, body) => {
  it("does not start or end with a parameter", () => {
    // Meta calls this a dangling parameter and rejects it outright.
    expect(body.trimStart().startsWith("{{")).toBe(false);
    expect(body.trimEnd().endsWith("}}")).toBe(false);
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
