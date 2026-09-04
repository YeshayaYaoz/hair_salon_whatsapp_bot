/**
 * WCAG 2 AA scan of the dashboard, the booking page and the public pages.
 *
 * Usage (from admin/, against a production build — `npm run build` first):
 *   npm start -- -p 3111 &
 *   node scripts/a11y-scan.mjs                    # every route
 *   node scripts/a11y-scan.mjs --route /dashboard/billing
 *   node scripts/a11y-scan.mjs --motion            # scan mid-animation too (see below)
 *   BASE=https://torionline.com node scripts/a11y-scan.mjs
 *
 * Exits non-zero when anything fails, so it can gate a deploy.
 *
 * ── Why there is no database here ──────────────────────────────────────────
 * The dashboard's auth guard is client-side: it reads localStorage.token and redirects when it is
 * missing. Nothing else about rendering depends on the server being real. So this seeds an
 * unsigned token and intercepts every call to the API origin, answering from fixtures below. That
 * makes the scan deterministic and runnable in CI with no Postgres, no seed data and no login —
 * and it means a failure here is always a markup or CSS problem, never a flaky environment.
 *
 * The token is decorative. It is never sent anywhere real: every API request is intercepted before
 * it leaves the browser. Do not add a genuine token to this file.
 *
 * ── Why animations are finished first ──────────────────────────────────────
 * The landing pages fade their content in. Run axe while that is happening and it measures text
 * at partial opacity and reports contrast failures that do not exist in the settled page: the
 * Hebrew home page reports 32 violations mid-fade and 0 once it settles. This waits, then finishes
 * every finite animation, before measuring. `--motion` skips the settling to show the transient
 * set — worth knowing, because a third party running an automated audit will see those numbers,
 * but they are not conformance failures and should not be "fixed" by dimming the design.
 *
 * Infinite animations (the marquee) are left alone; .finish() throws on them.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const BASE = process.env.BASE ?? "http://localhost:3111";
const args = process.argv.slice(2);
const only = args.includes("--route") ? args[args.indexOf("--route") + 1] : null;
const keepMotion = args.includes("--motion");

/** Header payload only — apiFetch base64-decodes this for UI state and never verifies it. */
const FAKE_JWT = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(
  JSON.stringify({ businessId: "a11y", exp: 4102444800 })
).toString("base64url")}.scan`;

/**
 * Fixtures, matched in order against the request path, so **more specific paths must come first**.
 * Getting that backwards is not a subtle failure: /api/business/me listed above its own children
 * answered /api/business/me/nav-badges with the business object, which broke the shared dashboard
 * layout and dropped all seventeen routes into the error boundary. Every page then "passed" or
 * "failed" identically, on markup none of them actually render.
 *
 * Empty lists are deliberate for most of them: an empty table still renders its headings, filters
 * and action buttons, which is where label and contrast problems live. Where a page collapses to
 * an empty state that hides the interesting markup, add a row here rather than standing up a
 * database — that keeps the scan reproducible.
 */
const FIXTURES = [
  ["/api/business/me/nav-badges", {}],
  ["/api/business/me/setup-status", { steps: [], complete: true }],
  ["/api/business/me", {
    id: "a11y", name: "מספרה לבדיקה", email: "a11y@example.invalid",
    subscriptionStatus: "active", subscriptionPlan: "premium", billingCycle: "monthly",
    timezone: "Asia/Jerusalem", notificationPhone: "972500000000",
    walletBalanceAgorot: 5000, messagesUsedThisCycle: 12,
    // Without this the layout bounces every route to /dashboard/onboarding, and the scan happily
    // reports twelve clean passes for one page it measured twelve times.
    businessTypeChosenAt: "2026-01-01T00:00:00.000Z", businessType: "salon",
  }],
  // Shape matches the Analytics interface in dashboard/analytics/page.tsx — the page reads
  // dailyThisWeek and topServices straight into Math.max(...list.map(...)), so a missing key is a
  // crash, not an empty chart.
  ["/api/business/analytics", {
    confirmedThisMonth: 0, cancelledThisMonth: 0, revenueThisMonth: 0,
    newCustomersThisMonth: 0, allTimeConfirmed: 0, prevWeekConfirmed: 0,
    dailyThisWeek: [], topServices: [],
  }],
  ["/api/business/appointments", []],
  ["/api/business/services", []],
  ["/api/business/staff", []],
  ["/api/business/customers", []],
  ["/api/business/hours", []],
  ["/api/business/faq", []],
  ["/api/business/waitlist", []],
  ["/api/business/coupons", []],
  ["/api/business/customer-coupons", []],
  ["/api/business/blocked-times", []],
  ["/api/business/blocked", []],
  ["/api/business/special-periods", []],
  ["/api/business/system-status", []],
  // The catch-alls stay last, and stay objects, so an endpoint nobody has stubbed yet fails
  // loudly (".map is not a function" → the error boundary → BOOM) instead of quietly rendering
  // half a page. Every array endpoint above earned its line that way.
  ["/api/business", {}],
  ["/api/", {}],
];

/**
 * Redirects the app performs on purpose. /dashboard/blocked is a thin alias that lands on the
 * hours page, which this scan measures under its own name — without this the run can never exit 0,
 * and a gate that always fails is a gate everyone learns to ignore.
 */
const EXPECTED_REDIRECTS = {
  "/dashboard": "/dashboard/analytics",
  "/dashboard/blocked": "/dashboard/hours",
};

const ROUTES = [
  "/", "/en", "/login", "/forgot-password", "/accessibility", "/terms", "/privacy",
  "/dashboard", "/dashboard/appointments", "/dashboard/analytics", "/dashboard/customers",
  "/dashboard/services", "/dashboard/staff", "/dashboard/hours", "/dashboard/faq",
  "/dashboard/billing", "/dashboard/payments", "/dashboard/whatsapp", "/dashboard/bot",
  "/dashboard/settings", "/dashboard/waitlist", "/dashboard/coupons", "/dashboard/blocked",
  "/dashboard/onboarding",
];

const FINISH_ANIMATIONS = () => {
  document.getAnimations().forEach((a) => {
    try {
      if (a.effect?.getComputedTiming().endTime !== Infinity) a.finish();
    } catch {
      /* an animation that refuses to finish is not worth failing the scan over */
    }
  });
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  reducedMotion: keepMotion ? null : "reduce",
});

await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin === new URL(BASE).origin) return route.continue();
  const hit = FIXTURES.find(([prefix]) => url.pathname.startsWith(prefix));
  if (!hit) return route.abort();
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(hit[1]) });
});

await context.addInitScript((token) => {
  try {
    localStorage.setItem("token", token);
    localStorage.setItem("lang", "he");
  } catch {
    /* storage disabled — the page still renders, it just lands on /login */
  }
}, FAKE_JWT);

const page = await context.newPage();
const failures = [];

for (const route of only ? [only] : ROUTES) {
  let result;
  try {
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 30_000 });
    if (!keepMotion) {
      await page.waitForTimeout(3000);
      await page.evaluate(FINISH_ANIMATIONS);
      await page.waitForTimeout(250);
    }
    await page.addScriptTag({ content: AXE });
    result = await page.evaluate(
      async () => await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } })
    );
  } catch (err) {
    console.log(`  ERROR   ${route}  ${err.message.split("\n")[0]}`);
    failures.push({ route, id: "scan-error", nodes: 1 });
    continue;
  }

  // A page that crashed into the error boundary renders a heading, a sentence and a button — it
  // scans perfectly cleanly and tells you nothing about the route you asked for. Treat it as a
  // broken scan, not a result: the first version of these fixtures put every dashboard route here
  // and the run looked like a real one.
  const boundary = await page.locator("text=משהו השתבש").count();
  if (boundary > 0) {
    console.log(`  BOOM  ${route.padEnd(28)}   rendered the error boundary — fixtures are wrong, not the page`);
    failures.push({ route, id: "error-boundary", nodes: 1 });
    continue;
  }

  // Same trap as the error boundary: a route that redirected was not the route that got measured.
  const landed = new URL(page.url()).pathname;
  if (landed !== route) {
    const expected = EXPECTED_REDIRECTS[route] === landed;
    console.log(`  ${expected ? "skip" : "SKIP"}  ${route.padEnd(28)}   redirected to ${landed}${expected ? " (expected)" : " — not measured"}`);
    if (!expected) failures.push({ route, id: "redirected", nodes: 1 });
    continue;
  }

  const total = result.violations.reduce((n, v) => n + v.nodes.length, 0);
  console.log(`  ${total === 0 ? "ok  " : "FAIL"}  ${route.padEnd(28)} ${String(total).padStart(3)}`);

  for (const v of result.violations) {
    failures.push({ route, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length });
    for (const n of v.nodes.slice(0, 4)) {
      console.log(`          [${v.impact}] ${v.id} — ${n.target[0]}`);
      console.log(`          ${(n.any[0]?.message ?? v.help).slice(0, 150)}`);
    }
    if (v.nodes.length > 4) console.log(`          … and ${v.nodes.length - 4} more`);
  }
}

await browser.close();

const totalNodes = failures.reduce((n, f) => n + f.nodes, 0);
console.log(
  totalNodes === 0
    ? `\nNo WCAG 2 AA violations across ${(only ? 1 : ROUTES.length)} route(s).`
    : `\n${totalNodes} violation(s) across ${new Set(failures.map((f) => f.route)).size} route(s).`
);
process.exit(totalNodes === 0 ? 0 : 1);
