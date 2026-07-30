import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const API = "http://localhost:4000";
const OUT = process.env.QA_OUT ?? "./qa-out";
fs.mkdirSync(OUT, { recursive: true });
const SALON_ID = "cms6nqvmi0000yvgraxprpd6j";

const ONLY = process.argv.slice(2); // optional route filter

const AUTHED = [
  ["/dashboard", "dashboard-home"],
  ["/dashboard/appointments", "appointments"],
  ["/dashboard/customers", "customers"],
  ["/dashboard/services", "services"],
  ["/dashboard/hours", "hours"],
  ["/dashboard/staff", "staff"],
  ["/dashboard/faq", "faq"],
  ["/dashboard/bot", "bot"],
  ["/dashboard/whatsapp", "whatsapp"],
  ["/dashboard/analytics", "analytics"],
  ["/dashboard/billing", "billing"],
  ["/dashboard/payments", "payments"],
  ["/dashboard/blocked", "blocked"],
  ["/dashboard/waitlist", "waitlist"],
  ["/dashboard/settings", "settings"],
  ["/dashboard/onboarding", "onboarding"],
  ["/dashboard/admin", "admin-fleet"],
  ["/dashboard/admin/leads", "admin-leads"],
];

const PUBLIC = [
  ["/", "landing-he"],
  ["/en", "landing-en"],
  ["/login", "login"],
  ["/forgot-password", "forgot-password"],
  ["/reset-password?token=faketoken", "reset-password"],
  ["/verify-email?token=faketoken", "verify-email"],
  ["/privacy", "privacy"],
  ["/terms", "terms"],
  ["/this-page-does-not-exist", "404"],
  [`/book/${SALON_ID}`, "public-booking"],
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
];

async function getToken() {
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa@torionline.test", password: "QaPassword123" }),
  });
  if (!r.ok) throw new Error(`login failed ${r.status} ${await r.text()}`);
  return (await r.json()).token;
}

const report = [];

async function visit(browser, token, viewport, lang, route, slug) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile ?? false,
    hasTouch: viewport.hasTouch ?? false,
    deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
    locale: lang === "he" ? "he-IL" : "en-US",
    timezoneId: "Asia/Jerusalem",
  });
  const consoleErrors = [];
  const pageErrors = [];
  const badRequests = [];

  await context.addInitScript(
    ([tk, lg]) => {
      if (tk) window.localStorage.setItem("token", tk);
      window.localStorage.setItem("lang", lg);
    },
    [token, lang]
  );

  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") consoleErrors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("response", (res) => {
    if (res.status() >= 400) badRequests.push(`${res.status()} ${res.request().method()} ${res.url()}`);
  });

  let navError = null;
  try {
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 45000 });
  } catch (e) {
    navError = String(e).split("\n")[0];
  }
  await page.waitForTimeout(1500);

  // Diagnostics inside the page
  const diag = await page.evaluate(() => {
    const de = document.documentElement;
    const overflow = de.scrollWidth - de.clientWidth;
    const wide = [];
    if (overflow > 1) {
      for (const el of document.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const right = r.right;
        const left = r.left;
        if (right > de.clientWidth + 2 || left < -2) {
          wide.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.getAttribute("class") || "").slice(0, 110),
            text: (el.textContent || "").trim().slice(0, 60),
            left: Math.round(left),
            right: Math.round(right),
            w: Math.round(r.width),
          });
        }
      }
    }
    // Hebrew text present on the page (for EN-mode leak detection)
    const hebrew = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const s = (n.nodeValue || "").trim();
      if (s && /[֐-׿]/.test(s)) hebrew.push(s.slice(0, 90));
    }
    // Elements whose text is clipped (overflowing their own box)
    const clipped = [];
    for (const el of document.querySelectorAll("h1,h2,h3,h4,p,span,button,a,td,th,label,div")) {
      if (el.children.length > 0) continue;
      if (el.scrollWidth > el.clientWidth + 3 && el.clientWidth > 0) {
        const st = getComputedStyle(el);
        if (st.overflow === "hidden" || st.overflowX === "hidden" || st.textOverflow === "ellipsis") continue;
        clipped.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || "").trim().slice(0, 50),
          scrollW: el.scrollWidth,
          clientW: el.clientWidth,
        });
      }
    }
    // Touch-target audit (mobile): interactive elements under 44px
    const smallTargets = [];
    for (const el of document.querySelectorAll("button,a,[role=switch],input[type=checkbox],select")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 32 || r.width < 24) {
        smallTargets.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40),
          h: Math.round(r.height),
          w: Math.round(r.width),
        });
      }
    }
    // Images without alt
    const noAlt = [...document.querySelectorAll("img")]
      .filter((i) => i.getAttribute("alt") === null)
      .map((i) => (i.getAttribute("src") || "").slice(0, 70));
    // Inputs with no accessible name
    const unlabeled = [];
    for (const el of document.querySelectorAll("input,select,textarea")) {
      if (el.type === "hidden") continue;
      const id = el.getAttribute("id");
      const hasLabel = id && document.querySelector(`label[for="${id}"]`);
      const wrapped = el.closest("label");
      if (!hasLabel && !wrapped && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !el.getAttribute("placeholder")) {
        unlabeled.push(`${el.tagName.toLowerCase()}[${el.type || "?"}] name=${el.getAttribute("name") || "-"}`);
      }
    }
    return {
      dir: de.dir,
      lang: de.lang,
      overflow,
      wide: wide.slice(0, 12),
      hebrewSample: [...new Set(hebrew)].slice(0, 40),
      clipped: clipped.slice(0, 10),
      smallTargets: smallTargets.slice(0, 12),
      noAlt,
      unlabeled: unlabeled.slice(0, 10),
      bodyText: (document.body.innerText || "").slice(0, 400),
      title: document.title,
    };
  });

  const file = path.join(OUT, `${viewport.name}-${lang}-${slug}.png`);
  try {
    await page.screenshot({ path: file, fullPage: true });
  } catch (e) {
    // fullPage can fail on very tall pages; fall back to viewport
    await page.screenshot({ path: file });
  }

  report.push({
    route,
    slug,
    viewport: viewport.name,
    lang,
    navError,
    ...diag,
    consoleErrors: [...new Set(consoleErrors)].slice(0, 12),
    pageErrors: [...new Set(pageErrors)].slice(0, 6),
    badRequests: [...new Set(badRequests)].slice(0, 10),
    shot: file,
  });
  process.stdout.write(`. ${viewport.name}/${lang}${route}\n`);
  await context.close();
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const token = await getToken();

for (const vp of VIEWPORTS) {
  for (const lang of ["he", "en"]) {
    for (const [route, slug] of AUTHED) {
      if (ONLY.length && !ONLY.some((o) => slug.includes(o))) continue;
      await visit(browser, token, vp, lang, route, slug);
    }
    for (const [route, slug] of PUBLIC) {
      if (ONLY.length && !ONLY.some((o) => slug.includes(o))) continue;
      // Landing pages are language-specific by path; skip the mismatched lang pass
      if (slug === "landing-he" && lang === "en") continue;
      if (slug === "landing-en" && lang === "he") continue;
      await visit(browser, null, vp, lang, route, slug);
    }
  }
}

await browser.close();
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(`\nDone: ${report.length} page visits. Report at ${path.join(OUT, "report.json")}`);
