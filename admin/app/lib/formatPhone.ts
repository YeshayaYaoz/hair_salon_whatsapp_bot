/** Formats an E.164-ish phone string (no leading "+", e.g. "972533391353") for display as
 * "+<country> (<area>) <rest>". Falls back to a plain "+digits" if the shape isn't recognized. */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");

  // Israeli numbers: 972 + 2-digit area/carrier code + 7-digit subscriber number.
  if (digits.startsWith("972") && digits.length === 12) {
    const rest = digits.slice(3);
    return `+972 (${rest.slice(0, 2)}) ${rest.slice(2, 5)}-${rest.slice(5)}`;
  }

  return digits ? `+${digits}` : phone;
}
