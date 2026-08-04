// Verifies the safe-area / bottom-chrome work on the running dev server.
//
// Two separate claims are being tested, and they need different evidence:
//
//   1. NO-OP WHERE THERE IS NO NOTCH. Headless Chromium reports env(safe-area-inset-*) as 0, which
//      is exactly what every non-notched device reports too. So every calc() built on --safe-*
//      must resolve to the same number it had before this change. Checked by asserting the literal
//      pre-change pixel values.
//
//   2. THE CLIPPING BUG IS ACTUALLY FIXED. <main>'s padded content box must clear the union of the
//      fixed bottom chrome, in the state that used to break it: setup incomplete, so the setup bar
//      is on screen at the same time as the tab bar.
//
// Run with the admin dev server on :3000 and the backend on :4000.

import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const BASE = "http://localhost:3000";
const PHONE = { width: 390, height: 844 };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
}

async function login(page, email, password = "QaPassword123") {
  // networkidle is not the same as hydrated: React can still be attaching handlers, and a click
  // that lands first submits the form natively (the URL comes back as /login? with no fields) and
  // never navigates. Waiting for the submit handler to exist is the actual precondition.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const btn = document.querySelector('button[type="submit"]');
    return btn && Object.keys(btn).some((k) => k.startsWith("__react"));
  }, { timeout: 20000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
}

const browser = await chromium.launch();

// ---------------------------------------------------------------- viewport meta
{
  const page = await browser.newPage({ viewport: PHONE });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const content = await page.getAttribute('meta[name="viewport"]', "content");
  check("viewport meta declares viewport-fit=cover", /viewport-fit=cover/.test(content ?? ""), content);
  await page.close();
}

// ---------------------------------------------- landing page is unchanged at env()=0
// The two landing pages disagree about the nav gutter at phone width and always have: the Hebrew
// page narrows it to 20px under a max-width:900px rule, the English page has no such rule and
// stays at its base 44px. Each is asserted against its own pre-change value, not a shared one.
for (const [label, path, navGutter] of [["he", "/", "20px"], ["en", "/en", "44px"]]) {
  const page = await browser.newPage({ viewport: PHONE });
  await page.goto(BASE + path, { waitUntil: "networkidle" });

  const nav = await page.evaluate(() => {
    const el = document.querySelector(".lp-nav");
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { height: r.height, top: r.top, padTop: cs.paddingTop, padLeft: cs.paddingLeft, padRight: cs.paddingRight };
  });
  check(`${label}: .lp-nav is still 62px tall at the top of the screen`,
    nav && Math.abs(nav.height - 62) < 0.5 && Math.abs(nav.top) < 0.5, JSON.stringify(nav));
  check(`${label}: .lp-nav notch padding collapses to 0`,
    nav && nav.padTop === "0px", nav?.padTop);
  check(`${label}: .lp-nav keeps its ${navGutter} gutters`,
    nav && nav.padLeft === navGutter && nav.padRight === navGutter, `${nav?.padLeft} / ${nav?.padRight}`);

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${label}: landing page has no horizontal overflow`, overflow <= 0, `${overflow}px`);

  await page.close();
}

// -------------------------------------------------- dashboard: chrome vs content
// Both seeded businesses sit mid-setup (the salon is 5/6, missing only WhatsApp), so both render
// the setup bar off the home page — which is precisely the state the old hard-coded pb-24 got
// wrong. The assertion is written to hold either way rather than to depend on the seed.
for (const [label, email] of [
  ["salon", "qa@torionline.test"],
  ["trial B&B", "bnb@torionline.test"],
]) {
  const page = await browser.newPage({ viewport: PHONE });
  try {
    await login(page, email);
  } catch (e) {
    check(`${label}: login`, false, String(e).slice(0, 120));
    await page.close();
    continue;
  }

  // Analytics is the home page and renders <SetupChecklist /> inline, so the fixed bar must not
  // also be there. Every other page is where the bar is supposed to appear.
  for (const [pageLabel, path] of [["home", "/dashboard/analytics"], ["appointments", "/dashboard/appointments"]]) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200); // setup-status fetch + ResizeObserver publish

    const m = await page.evaluate(() => {
      const main = document.getElementById("main-content");
      const cs = getComputedStyle(main);
      const r = main.getBoundingClientRect();

      // Every fixed element occupying the bottom of the viewport. Deliberately NOT "flush with the
      // bottom edge" — the dock now floats, so its own bottom sits ~10px up (plus the home-indicator
      // inset), and requiring flushness would find nothing at all.
      const bottomChrome = [...document.querySelectorAll("body *")]
        .filter((el) => {
          const s = getComputedStyle(el);
          if (s.position !== "fixed" || s.display === "none" || s.visibility === "hidden") return false;
          const b = el.getBoundingClientRect();
          return b.height > 0 && b.bottom >= window.innerHeight * 0.75;
        })
        .map((el) => {
          const b = el.getBoundingClientRect();
          return { tag: el.tagName.toLowerCase(), cls: el.className.toString().slice(0, 40), top: b.top, height: b.height };
        });

      const topOfChrome = bottomChrome.length ? Math.min(...bottomChrome.map((c) => c.top)) : window.innerHeight;

      // The setup prompt is no longer a bar of its own: it is a strip inside the dock, so it is the
      // dock's direct <a> child. (The tabs are links too, but they live inside the dock's <nav>.)
      const dock = [...document.querySelectorAll("body > * *")].find((el) => {
        const s = getComputedStyle(el);
        return s.position === "fixed" && el.querySelector(":scope > nav") && el.getBoundingClientRect().height > 0;
      });
      const setupStrip = dock ? dock.querySelector(":scope > a") : null;

      return {
        paddingBottom: parseFloat(cs.paddingBottom),
        pathname: location.pathname,
        setupStripPresent: Boolean(setupStrip),
        // Smallest tappable dimension in the dock — tabs must stay finger-sized as it shrinks.
        minDockTap: dock
          ? Math.min(...[...dock.querySelectorAll("nav > a, nav > button")].map((el) => {
              const r = el.getBoundingClientRect();
              return Math.round(Math.min(r.width, r.height));
            }))
          : null,
        // The inline checklist is the thing the fixed bar must not duplicate. Identified by its
        // heading rather than a class, so it survives restyling.
        hasInlineChecklist: [...document.querySelectorAll("h2,h3")]
          .some((h) => /השלמת ההגדרות|Finish setting up/.test(h.textContent || "")),
        dockOccupied: getComputedStyle(document.documentElement).getPropertyValue("--mobile-dock-occupied").trim(),
        chromeHeight: window.innerHeight - topOfChrome,
        bottomChrome,
        // Where the last line of real content can reach, in page coordinates.
        contentBottom: r.bottom - parseFloat(cs.paddingBottom),
        scrollHeight: document.documentElement.scrollHeight,
      };
    });

    const setupBarPresent = m.setupStripPresent;

    // Stated as the rule itself rather than as a path, because which page an account lands on
    // varies: a business that hasn't picked a type yet is redirected to /dashboard/onboarding,
    // where there is no inline checklist and the bar is exactly what should be there.
    check(`${label} / ${pageLabel}: never nagged about setup twice on one screen`,
      !(m.hasInlineChecklist && setupBarPresent),
      `at ${m.pathname}: inline checklist ${m.hasInlineChecklist ? "present" : "absent"}, ` +
      `fixed bar ${setupBarPresent ? "present" : "absent"}`);

    // ...and the corollary: suppressing it must not have silently killed it everywhere. Both
    // seeded accounts are mid-setup, so a page without the inline checklist must still show it.
    if (!m.hasInlineChecklist) {
      check(`${label} / ${pageLabel}: setup bar still reaches pages that need it`, setupBarPresent,
        `at ${m.pathname}, bottom chrome ${JSON.stringify(m.bottomChrome.map((c) => c.tag))}`);
    }

    check(`${label} / ${pageLabel}: <main> reserves at least the chrome it sits under`,
      m.paddingBottom >= m.chromeHeight,
      `padding-bottom ${m.paddingBottom}px vs ${m.chromeHeight}px of chrome ` +
      `(--mobile-dock-occupied ${m.dockOccupied || "unset"})`);

    check(`${label} / ${pageLabel}: dock tab targets stay finger-sized`,
      m.minDockTap !== null && m.minDockTap >= 44, `smallest dimension ${m.minDockTap}px`);
  }

  await page.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}\n        ${r.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
