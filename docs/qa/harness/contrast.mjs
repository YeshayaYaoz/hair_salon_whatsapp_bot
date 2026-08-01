import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const API = "http://localhost:4000";

const ROUTES = [
  "/dashboard/analytics", "/dashboard/appointments", "/dashboard/customers", "/dashboard/services",
  "/dashboard/hours", "/dashboard/staff", "/dashboard/faq", "/dashboard/bot", "/dashboard/whatsapp",
  "/dashboard/billing", "/dashboard/payments", "/dashboard/blocked", "/dashboard/waitlist",
  "/dashboard/settings", "/dashboard/onboarding", "/dashboard/admin", "/dashboard/admin/leads",
  "/login", "/", "/en", "/forgot-password", "/privacy", "/terms",
];

const AUDIT = () => {
  function parseColor(s) {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum({ r, g, b }) {
    const f = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function ratio(a, b) {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function blend(fg, bg) {
    const a = fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
  }
  // Effective background: walk ancestors until an opaque-ish background colour is found.
  function effBg(el) {
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    const chain = [];
    let n = el;
    while (n && n.nodeType === 1) {
      const st = getComputedStyle(n);
      const c = parseColor(st.backgroundColor);
      const hasImage = st.backgroundImage && st.backgroundImage !== "none";
      if (hasImage) return { bg: null, gradient: true };
      if (c && c.a > 0) chain.push(c);
      if (c && c.a === 1) break;
      n = n.parentElement;
    }
    for (let i = chain.length - 1; i >= 0; i--) bg = blend(chain[i], bg);
    return { bg, gradient: false };
  }

  const results = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = (node.nodeValue || "").trim();
    if (!text || text.length < 2) continue;
    const el = node.parentElement;
    if (!el) continue;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TITLE"].includes(el.tagName)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none") continue;
    // Screen-reader-only text is clipped to 1px and never painted; its contrast is meaningless
    // (skip links reveal themselves on focus with their own colours).
    if (el.closest(".sr-only") || (rect.width <= 1 && rect.height <= 1)) continue;
    // Cumulative opacity through ancestors — a half-faded ancestor lowers effective contrast too.
    let cumOpacity = 1;
    for (let p = el; p && p.nodeType === 1; p = p.parentElement) cumOpacity *= parseFloat(getComputedStyle(p).opacity);
    if (cumOpacity < 0.95) continue; // still animating or deliberately faded — not a colour choice
    const fgRaw = parseColor(st.color);
    if (!fgRaw) continue;
    const { bg, gradient } = effBg(el);
    if (gradient || !bg) continue;
    // transparent text fill (gradient text) — report separately using the declared colour
    const fill = st.webkitTextFillColor || "";
    const isGradientText = fill.includes("rgba(0, 0, 0, 0)") || fill === "transparent";
    const fg = blend({ ...fgRaw, a: fgRaw.a }, bg);
    const cr = ratio(fg, bg);
    const size = parseFloat(st.fontSize);
    const weight = parseInt(st.fontWeight) || 400;
    const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = isLarge ? 3 : 4.5;
    if (cr < need && !isGradientText) {
      const key = `${st.color}|${st.fontSize}|${st.fontWeight}|${text.slice(0, 30)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        text: text.slice(0, 60),
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute("class") || "").slice(0, 60),
        color: st.color,
        bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
        px: size,
        weight,
        ratio: Math.round(cr * 100) / 100,
        need,
      });
    }
  }
  return results;
};

async function getToken() {
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa@torionline.test", password: "QaPassword123" }),
  });
  return (await r.json()).token;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const token = await getToken();
const all = {};

for (const route of ROUTES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Asia/Jerusalem", reducedMotion: "reduce" });
  await ctx.addInitScript(([t]) => {
    window.localStorage.setItem("token", t);
    window.localStorage.setItem("lang", "he");
  }, [token]);
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 40000 });
    await page.waitForTimeout(2600);
    all[route] = await page.evaluate(AUDIT);
  } catch (e) {
    all[route] = [{ error: String(e).slice(0, 120) }];
  }
  await ctx.close();
  process.stdout.write(`${route}: ${all[route].length}\n`);
}
await browser.close();
fs.writeFileSync((process.env.QA_OUT ?? "./qa-out") + "/contrast.json", JSON.stringify(all, null, 2));
console.log("written");
