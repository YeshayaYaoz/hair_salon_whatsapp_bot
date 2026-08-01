"use client";

/**
 * Props that replace the browser's built-in validation bubble with our own copy.
 *
 * `required` alone raises Chromium's "Please fill out this field." — in English, because that string
 * follows the *browser's* UI language, not the page's. In a Hebrew-first product that means an
 * English popup on an otherwise fully Hebrew form, for the majority of users.
 *
 * setCustomValidity has to be cleared on input, or the field stays permanently invalid once it has
 * been flagged.
 *
 * Usage: `<input {...requiredField(he ? "יש למלא שדה זה" : "Please fill out this field")} />`
 */
// Parameters are widened to HTMLElement so one returned object spreads onto <input>, <select> and
// <textarea> alike: a handler taking the wider event type is assignable wherever the narrower
// FormEventHandler<HTMLSelectElement> etc. is expected.
type FieldEvent = React.FormEvent<HTMLElement>;
type ValidatableField = { validity: ValidityState; setCustomValidity: (m: string) => void };

export function requiredField(message: string) {
  return {
    required: true,
    onInvalid: (e: FieldEvent) => {
      const el = e.currentTarget as unknown as ValidatableField;
      // Only override the "empty required field" case — leave type-specific messages (a malformed
      // email, an out-of-range date) to the browser, which words them better than a generic string.
      if (el.validity.valueMissing) el.setCustomValidity(message);
    },
    onInput: (e: FieldEvent) => {
      (e.currentTarget as unknown as ValidatableField).setCustomValidity("");
    },
  };
}
