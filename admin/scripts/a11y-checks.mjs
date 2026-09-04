/**
 * The four accessibility-statement claims axe cannot check.
 *
 * scripts/a11y-scan.mjs covers what an automated rule engine can decide — contrast, labels, roles.
 * That is roughly a third of WCAG. The statement also promises keyboard operation with a visible
 * focus ring, text enlargement to 200% without loss of content, enlarged touch targets, and
 * respect for prefers-reduced-motion. Each of those needs driving the page, not inspecting it.
 *
 * Usage (from admin/, against a production build, server on :3111):
 *   node scripts/a11y-checks.mjs
 *   node scripts/a11y-checks.mjs --route /dashboard/hours
 *   node scripts/a11y-checks.mjs --only keyboard|zoom|touch|motion
 *
 * Shares the fixture/auth approach with a11y-scan.mjs — see the long comment there for why there
 * is no database involved. Exits non-zero on any failure.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3111";
const args = process.argv.slice(2);
const only = args.includes("--route") ? args[args.indexOf("--route") + 1] : null;
const onlyCheck = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

const FAKE_JWT = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(
  JSON.stringify({ businessId: "a11y", exp: 4102444800 })
).toString("base64url")}.scan`;

const FIXTURES = [
  ["/api/business/me/nav-badges", {}],
  ["/api/business/me/setup-status", { steps: [], complete: true }],
  ["/api/business/me", {
    id: "a11y", name: "מספרה לבדיקה", email: "a11y@example.invalid",
    subscriptionStatus: "active", subscriptionPlan: "premium", billingCycle: "monthly",
    timezone: "Asia/Jerusalem", notificationPhone: "972500000000",
    walletBalanceAgorot: 5000, messagesUsedThisCycle: 12,
    businessTypeChosenAt: "2026-01-01T00:00:00.000Z", businessType: "salon",
  }],
  ["/api/business/analytics", {
    confirmedThisMonth: 0, cancelledThisMonth: 0, revenueThisMonth: 0,
    newCustomersThisMonth: 0, allTimeConfirmed: 0, prevWeekConfirmed: 0,
    dailyThisWeek: [], topServices: [],
  }],
  ["/api/business/appointments", []], ["/api/business/services", []],
  ["/api/business/staff", []], ["/api/business/customers", []],
  ["/api/business/hours", []], ["/api/business/faq", []],
  ["/api/business/waitlist", []], ["/api/business/coupons", []],
  ["/api/business/customer-coupons", []], ["/api/business/blocked-times", []],
  ["/api/business/blocked", []], ["/api/business/special-periods", []],
  ["/api/business/system-status", []],
  ["/api/business", {}], ["/api/", {}],
];

const ROUTES = [
  "/", "/login", "/accessibility",
  "/dashboard/appointments", "/dashboard/analytics", "/dashboard/customers",
  "/dashboard/services", "/dashboard/staff", "/dashboard/hours", "/dashboard/faq",
  "/dashboard/billing", "/dashboard/payments", "/dashboard/whatsapp", "/dashboard/bot",
  "/dashboard/settings", "/dashboard/waitlist", "/dashboard/coupons", "/dashboard/onboarding",
];

const failures = [];
const fail = (route, check, detail) => {
  failures.push({ route, check, detail });
  console.log(`     ✗ ${detail}`);
};

/* ────────────────────────────── keyboard ────────────────────────────── */

/**
 * Everything a keyboard user must be able to reach, and what "visible" means for it. Elements
 * inside `inert`/`aria-hidden` subtrees or sized 0×0 are excluded — they are not on screen.
 */
const INTERACTIVE = `a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]),
  select:not(:disabled), textarea:not(:disabled), summary,
  [tabindex]:not([tabindex="-1"]), [role="button"], [role="switch"], [role="link"]`;

const COUNT_REACHABLE = (sel) => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none") return false;
    return !el.closest("[inert]") && !el.closest('[aria-hidden="true"]');
  };
  return [...document.querySelectorAll(sel)].filter(visible).length;
};

async function checkKeyboard(page, route) {
  // A positive tabindex overrides document order and is a WCAG 2.4.3 problem on its own.
  const positive = await page.$$eval("[tabindex]", (els) =>
    els.filter((e) => Number(e.getAttribute("tabindex")) > 0).map((e) => e.tagName.toLowerCase())
  );
  if (positive.length) fail(route, "keyboard", `positive tabindex on ${positive.join(", ")} — overrides document order`);

  const expected = await page.evaluate(COUNT_REACHABLE, INTERACTIVE);
  if (expected === 0) return;

  // Walk forward with Tab, recording where focus lands and whether a ring actually appears.
  await page.evaluate(() => document.body.focus());
  const seen = new Set();
  let noRing = [];
  const budget = Math.min(expected * 3 + 20, 250);

  for (let i = 0; i < budget; i++) {
    await page.keyboard.press("Tab");
    // The ring is transitioned in — the sidebar links carry `transition-all`, which animates
    // outline-width from 0. Measured immediately, every one of them reports no focus indicator and
    // the run "finds" that the whole dashboard navigation is unusable by keyboard. It is not: at
    // rest they all carry the 2px ring. Settle first, then measure.
    await page.waitForTimeout(220);
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const ring =
        (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) ||
        (s.boxShadow && s.boxShadow !== "none");
      const r = el.getBoundingClientRect();
      return {
        key: (el.tagName + "|" + (el.id || "") + "|" + (el.className || "").toString().slice(0, 40) +
             "|" + (el.textContent || "").trim().slice(0, 25)),
        ring,
        tag: el.tagName.toLowerCase(),
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
        offscreen: r.width === 0 && r.height === 0,
      };
    });
    if (!info) break;
    if (seen.has(info.key)) break; // cycled back round
    seen.add(info.key);
    if (!info.ring && !info.offscreen) noRing.push(`${info.tag} "${info.label}"`);
  }

  // The statement's promise is a ring on *every* component, so any element that takes focus
  // without one is a miss — this is the check that catches a new control styled outline-none.
  if (noRing.length) {
    const shown = [...new Set(noRing)].slice(0, 5);
    fail(route, "keyboard", `${noRing.length} focusable element(s) with no visible focus indicator: ${shown.join("; ")}`);
  }
  // Reaching far fewer elements than exist usually means a trap or a container swallowing Tab.
  if (seen.size < Math.min(expected, 3)) {
    fail(route, "keyboard", `Tab reached ${seen.size} of ~${expected} interactive elements — possible keyboard trap`);
  }
}

/* ──────────────────────────────── zoom ──────────────────────────────── */

/**
 * Two separate promises live in "text can be enlarged to 200% without loss of content":
 * text-only enlargement (root font-size doubled, which is what a browser's text-size setting and
 * most screen magnifiers do) and full page zoom (which shrinks the CSS viewport). Both are checked,
 * because a layout can survive one and break under the other.
 */
async function checkZoom(page, route) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "32px"));
  await page.waitForTimeout(400);
  const textZoom = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    clipped: [...document.querySelectorAll("h1,h2,h3,p,button,a,label,span")]
      .filter((el) => {
        const s = getComputedStyle(el);
        if (el.className && String(el.className).includes("sr-only")) return false;
        if (s.overflow === "visible" || el.scrollWidth === 0) return false;
        // A deliberate one-line truncation is a design choice; real loss is vertical clipping.
        return el.scrollHeight > el.clientHeight + 2 && s.overflowY === "hidden";
      })
      .slice(0, 3)
      .map((el) => el.tagName.toLowerCase() + ": " + (el.textContent || "").trim().slice(0, 30)),
  }));
  await page.evaluate(() => (document.documentElement.style.fontSize = ""));

  if (textZoom.overflow > 4) {
    fail(route, "zoom", `text at 200% forces ${textZoom.overflow}px of horizontal scrolling`);
  }
  if (textZoom.clipped.length) {
    fail(route, "zoom", `text at 200% is clipped: ${textZoom.clipped.join(" | ")}`);
  }

  // Page zoom to 200% ≈ half the CSS viewport at the same window size.
  await page.setViewportSize({ width: 640, height: 450 });
  await page.waitForTimeout(400);
  const pageZoom = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (pageZoom > 4) fail(route, "zoom", `page zoomed to 200% scrolls ${pageZoom}px horizontally`);
  await page.setViewportSize({ width: 1280, height: 900 });
}

/* ─────────────────────────────── touch ──────────────────────────────── */

/**
 * Measured at phone width, since the claim is explicitly about touch devices.
 *
 * 24×24 is the WCAG 2.2 AA floor (2.5.8) and is treated as a failure. 44×44 is Apple's guidance
 * and roughly what "comfortable with a thumb" means; those are reported as warnings, not failures,
 * because WCAG 2.0 AA — the standard the statement actually names — has no target-size rule at all.
 * Links inside a run of prose are exempt from 2.5.8 and are skipped.
 */
async function checkTouch(browser, route) {
  // Must run in a context that actually reports a coarse pointer. The .row-action utility raises
  // its min-height to 44px only inside `@media (pointer: coarse)`, which is precisely the
  // condition the statement's claim is scoped to ("on touch devices"). Measured in the default
  // mouse context that rule never applies, and the run reports eighteen routes of undersized
  // buttons that are the right size on every device the claim is about.
  const ctx = await newContext(browser, {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(1200);
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  if (!coarse) {
    await ctx.close();
    fail(route, "touch", "context did not report a coarse pointer — touch measurement would be meaningless");
    return;
  }
  const small = await page.evaluate((sel) => {
    const inlineInProse = (el) => {
      if (el.tagName !== "A") return false;
      const p = el.parentElement;
      if (!p) return false;
      return getComputedStyle(el).display.startsWith("inline") && (p.textContent || "").trim().length > (el.textContent || "").trim().length + 12;
    };
    const out = { tiny: [], snug: [], smallLinks: [] };
    for (const el of document.querySelectorAll(sel)) {
      // A checkbox is 16px by design here, but the hours page wraps each one in a label so the
      // day name is part of the tap target. The control's own box is not the target a thumb hits.
      const wrapper = el.closest("label");
      const target = wrapper && wrapper.contains(el) ? wrapper : el;
      const r = target.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || el.closest('[aria-hidden="true"]')) continue;
      if (inlineInProse(el)) continue;
      // A skip link is deliberately 1×1 until it takes focus, at which point it becomes a normal
      // sized control. Measuring it at rest reports a 1×1 tap target that no pointer user can see.
      if (el.className && String(el.className).includes("sr-only")) continue;
      const name = el.tagName.toLowerCase() + ' "' +
        (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 28) + '"' +
        ` ${Math.round(r.width)}×${Math.round(r.height)}`;
      // Links are reported but not failed. WCAG 2.0 — the standard the accessibility statement
      // actually names — has no target-size criterion at all, and 2.5.8 (which arrived in 2.2)
      // exempts a target "in a sentence or otherwise constrained by the line-height of non-target
      // text", which is what a text link is. Controls get no such exemption, and the statement's
      // own wording is about action buttons, so those fail.
      const isLink = el.tagName === "A";
      if (r.width < 24 || r.height < 24) (isLink ? out.smallLinks : out.tiny).push(name);
      else if (r.width < 44 || r.height < 44) out.snug.push(name);
    }
    return out;
  }, INTERACTIVE);

  await ctx.close();

  if (small.tiny.length) {
    fail(route, "touch", `${small.tiny.length} target(s) under 24×24: ${[...new Set(small.tiny)].slice(0, 4).join("; ")}`);
  }
  if (small.smallLinks.length) {
    console.log(`     · ${small.smallLinks.length} text link(s) under 24px tall (no WCAG 2.0 rule; 2.2 exempts inline text): ${[...new Set(small.smallLinks)].slice(0, 3).join("; ")}`);
  }
  if (small.snug.length) {
    console.log(`     · ${small.snug.length} target(s) between 24 and 44px (under Apple's 44, above the WCAG 2.2 floor): ${[...new Set(small.snug)].slice(0, 3).join("; ")}`);
  }
}

/* ─────────────────────────────── motion ─────────────────────────────── */

/**
 * Checked by comparison, not assertion: the same route is loaded in two contexts and the running
 * animation count comes back different. Asserting "no animations" alone would also pass on a page
 * that simply has none, which proves nothing about whether the preference is honoured.
 */
async function checkMotion(browser, route) {
  const counts = {};
  for (const [label, reduced] of [["on", null], ["reduce", "reduce"]]) {
    const ctx = await newContext(browser, { reducedMotion: reduced });
    const pg = await ctx.newPage();
    await pg.goto(BASE + route, { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(150); // sample early, while entrance animations should still be live
    counts[label] = await pg.evaluate(() =>
      document.getAnimations().filter((a) => {
        const t = a.effect?.getComputedTiming();
        return a.playState === "running" && (t?.duration ?? 0) > 50;
      }).length
    );
    await ctx.close();
  }
  if (counts.on > 0 && counts.reduce > 0) {
    fail(route, "motion", `${counts.reduce} animation(s) still running under prefers-reduced-motion (${counts.on} without it)`);
  }
  return counts;
}

/* ──────────────────────────────── run ───────────────────────────────── */

async function newContext(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  await ctx.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(BASE).origin) return route.continue();
    const hit = FIXTURES.find(([p]) => url.pathname.startsWith(p));
    if (!hit) return route.abort();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(hit[1]) });
  });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem("token", t); localStorage.setItem("lang", "he"); } catch {}
  }, FAKE_JWT);
  return ctx;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox"],
});
const context = await newContext(browser);
const page = await context.newPage();
const routes = only ? [only] : ROUTES;
const want = (name) => !onlyCheck || onlyCheck === name;
let motionTotals = { on: 0, reduce: 0 };

for (const route of routes) {
  console.log(`\n  ${route}`);
  await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(1200);

  if (await page.locator("text=משהו השתבש").count()) {
    fail(route, "setup", "rendered the error boundary — fixtures are wrong, not the page");
    continue;
  }

  const before = failures.length;
  if (want("keyboard")) await checkKeyboard(page, route);
  if (want("zoom")) await checkZoom(page, route);
  if (want("touch")) await checkTouch(browser, route);
  if (want("motion")) {
    const c = await checkMotion(browser, route);
    motionTotals.on += c.on;
    motionTotals.reduce += c.reduce;
  }
  if (failures.length === before) console.log("     ok");
}

await browser.close();

if (want("motion")) {
  console.log(`\n  motion: ${motionTotals.on} running animation(s) with motion allowed, ${motionTotals.reduce} under prefers-reduced-motion.`);
}
console.log(
  failures.length === 0
    ? `\nAll requested checks passed across ${routes.length} route(s).`
    : `\n${failures.length} failure(s): ` +
      [...new Set(failures.map((f) => f.check))].map((c) => `${c}=${failures.filter((f) => f.check === c).length}`).join(" ")
);
process.exit(failures.length ? 1 : 0);
