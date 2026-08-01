import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3000", API = "http://localhost:4000";
const r = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "qa@torionline.test", password: "QaPassword123" }) });
const tk = (await r.json()).token;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function ctxFor(mobile) {
  const c = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile, hasTouch: mobile, locale: "he-IL", timezoneId: "Asia/Jerusalem", reducedMotion: "reduce",
  });
  await c.addInitScript(([t]) => { localStorage.setItem("token", t); localStorage.setItem("lang", "he"); }, [tk]);
  return c;
}

// A. Mobile calendar: do appointment chips fit their grid cell?
{
  const c = await ctxFor(true); const p = await c.newPage();
  await p.goto(BASE + "/dashboard/appointments", { waitUntil: "networkidle" });
  await p.waitForTimeout(1800);
  const out = await p.evaluate(() => {
    const chips = [...document.querySelectorAll("div[title]")].filter((d) => /\d{1,2}:\d{2}/.test(d.textContent || ""));
    return chips.slice(0, 6).map((ch) => {
      const cell = ch.parentElement;
      const cr = ch.getBoundingClientRect(), pr = cell.getBoundingClientRect();
      return {
        text: (ch.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
        chipW: Math.round(cr.width), cellW: Math.round(pr.width),
        chipScrollW: ch.scrollWidth, chipClientW: ch.clientWidth,
        overflowsCell: cr.width > pr.width + 1,
      };
    });
  });
  console.log("A. mobile calendar chips:", JSON.stringify(out, null, 1));
  await c.close();
}

// B. Hover-only cancel button: reachable by touch / keyboard?
{
  const c = await ctxFor(false); const p = await c.newPage();
  await p.goto(BASE + "/dashboard/appointments", { waitUntil: "networkidle" });
  await p.waitForTimeout(1800);
  const out = await p.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "×");
    if (!btns.length) return "no × buttons found";
    const b = btns[0];
    const st = getComputedStyle(b);
    const rect = b.getBoundingClientRect();
    // is it in the tab order while invisible?
    b.focus();
    const focusedWhileTransparent = document.activeElement === b && st.opacity === "0";
    return {
      count: btns.length, opacity: st.opacity, pointerEvents: st.pointerEvents,
      size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
      tabbableWhileInvisible: focusedWhileTransparent,
      opacityAfterFocus: getComputedStyle(b).opacity,
    };
  });
  console.log("\nB. hover-only cancel button:", JSON.stringify(out, null, 1));
  await c.close();
}

// C. Modal: focus trap + escape + aria
{
  const c = await ctxFor(false); const p = await c.newPage();
  await p.goto(BASE + "/dashboard/appointments", { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  await p.getByRole("button", { name: /תור חדש/ }).click();
  await p.waitForTimeout(600);
  const before = await p.evaluate(() => ({
    activeTag: document.activeElement?.tagName,
    dialogRole: !!document.querySelector('[role="dialog"]'),
    ariaModal: !!document.querySelector('[aria-modal="true"]'),
    bodyOverflow: getComputedStyle(document.body).overflow,
  }));
  await p.keyboard.press("Escape");
  await p.waitForTimeout(500);
  const afterEsc = await p.evaluate(() => !!document.querySelector("form select, form input[type=datetime-local]"));
  // tab 12 times — does focus escape the dialog into the page behind?
  await p.getByRole("button", { name: /תור חדש/ }).click().catch(() => {});
  await p.waitForTimeout(500);
  const escaped = [];
  for (let i = 0; i < 12; i++) {
    await p.keyboard.press("Tab");
    const info = await p.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const inDialog = !!el.closest("form");
      return { tag: el.tagName, text: (el.textContent || "").trim().slice(0, 22), inForm: inDialog };
    });
    escaped.push(info);
  }
  console.log("\nC. modal a11y:", JSON.stringify({ before, stillOpenAfterEscape: afterEsc, tabPath: escaped }, null, 1));
  await c.close();
}

// D. Skip link + landmarks
{
  const c = await ctxFor(false); const p = await c.newPage();
  await p.goto(BASE + "/dashboard/analytics", { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  const out = await p.evaluate(() => ({
    skipLink: [...document.querySelectorAll("a")].slice(0, 3).map((a) => (a.textContent || "").trim().slice(0, 30)),
    main: document.querySelectorAll("main").length,
    nav: document.querySelectorAll("nav").length,
    h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim().slice(0, 30)),
    headingOrder: [...document.querySelectorAll("h1,h2,h3,h4")].map((h) => h.tagName),
    landmarks: [...document.querySelectorAll("[role]")].map((e) => e.getAttribute("role")).slice(0, 10),
  }));
  console.log("\nD. landmarks/skip-link:", JSON.stringify(out, null, 1));
  await c.close();
}

await browser.close();
