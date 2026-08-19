/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // The product's accent. Previously `brand` was #F59E0B (amber) alongside four slate-*
        // shades — all leftovers from an earlier dark/amber theme with zero usages anywhere in
        // app/, while the real accent lived as a bare #1B7FA0 hex repeated across files. These are
        // the single source of truth; prefer them over literal hexes in new code.
        brand: {
          DEFAULT: "#1B7FA0", // 4.58:1 on white — passes AA for text and for white-on-brand buttons
          dark: "#145F78", // hover/pressed
          light: "#2A9BBF",
          tint: "#E0F5FB", // hover/selected surface
          ring: "#D6F0F8",
        },
        // WhatsApp brand green. `DEFAULT` is Meta's exact green and is for FILLS ONLY — chat
        // mockups, the phone illustration. It is 1.98:1 against white, so it must never carry text
        // or sit under white text. Use `ink` (5.0:1 on white) for anything with a label on it.
        wa: {
          DEFAULT: "#25D366",
          ink: "#0F8043",
          "ink-dark": "#0B6634",
        },
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-in-end": {
          "0%": { opacity: "0", transform: "translateX(24px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "slide-in-start": {
          "0%": { opacity: "0", transform: "translateX(-24px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.92)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "pop": {
          "0%": { transform: "scale(0.85)" },
          "60%": { transform: "scale(1.08)" },
          "100%": { transform: "scale(1)" },
        },
        "shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      // Entrances decelerate (--ease-entrance), so an element arrives and settles instead of
      // hanging at its offset for the first few frames the way plain `ease` makes it. `pop` keeps
      // its own overshoot curve — it is the confirmation animation, and the bounce is the point.
      // The curves themselves are defined once on :root in globals.css.
      animation: {
        "fade-up": "fade-up 0.4s var(--ease-entrance) both",
        "fade-up-slow": "fade-up 0.6s var(--ease-entrance) both",
        "fade-in": "fade-in 0.3s var(--ease-entrance) both",
        "slide-in-end": "slide-in-end 0.3s var(--ease-entrance) both",
        "slide-in-start": "slide-in-start 0.3s var(--ease-entrance) both",
        "scale-in": "scale-in 0.25s var(--ease-entrance) both",
        "pop": "pop 0.3s var(--ease-spring) both",
      },
    },
  },
  plugins: [],
}
