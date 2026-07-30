/**
 * Darkens a colour until it reads accessibly on a light tint of itself.
 *
 * Service colours are picked by the salon owner from a swatch list, then reused as both the chip
 * background (at ~7% alpha) and the chip's text colour. Several of the stock swatches fail WCAG AA
 * that way — amber #F59E0B on its own tint is 2.04:1, emerald #059669 is 3.47:1 — and since the
 * palette is user-facing, no amount of hand-tuning individual swatches keeps it safe. So the text
 * colour is derived instead: keep the hue, walk the lightness down until it clears the threshold.
 */

function toRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** `color` composited over white at `alpha` — what the tinted chip background actually renders as. */
function tintOverWhite(rgb: { r: number; g: number; b: number }, alpha: number) {
  return {
    r: rgb.r * alpha + 255 * (1 - alpha),
    g: rgb.g * alpha + 255 * (1 - alpha),
    b: rgb.b * alpha + 255 * (1 - alpha),
  };
}

/**
 * Returns `hex` darkened just enough to hit `target` contrast against its own `alpha` tint.
 * Returns the input unchanged when it already passes, and falls back to it if unparseable.
 */
export function readableOnTint(hex: string, alpha = 0.07, target = 4.5): string {
  const rgb = toRgb(hex);
  if (!rgb) return hex;
  const bg = tintOverWhite(rgb, alpha);
  // 20 steps of 5% is enough to reach near-black from any starting colour, and stepping
  // multiplicatively keeps the hue while only dropping lightness.
  let cur = rgb;
  for (let i = 0; i < 20; i++) {
    if (contrast(cur, bg) >= target) break;
    cur = { r: Math.round(cur.r * 0.95), g: Math.round(cur.g * 0.95), b: Math.round(cur.b * 0.95) };
  }
  return `#${[cur.r, cur.g, cur.b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
