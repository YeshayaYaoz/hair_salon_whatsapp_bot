import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const API = "http://localhost:4000";
const OUT = process.env.QA_OUT ?? "./qa-out";
fs.mkdirSync(OUT, { recursive: true });

async function token(email = "qa@torionline.test") {
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "QaPassword123" }),
  });
  return (await r.json()).token;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const notes = [];

async function session({ lang = "he", mobile = false, tk = null, route, name, steps }) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1,
    locale: lang === "he" ? "he-IL" : "en-US", timezoneId: "Asia/Jerusalem",
    reducedMotion: "reduce",
  });
  await ctx.addInitScript(([t, l]) => {
    if (t) localStorage.setItem("token", t);
    localStorage.setItem("lang", l);
  }, [tk, lang]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errs.push("[console] " + m.text().slice(0, 200)); });
  await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1200);
  try {
    await steps(page, async (label) => {
      const f = `${OUT}/ix-${name}-${label}.png`;
      await page.screenshot({ path: f, fullPage: false });
      return f;
    });
  } catch (e) {
    notes.push({ name, error: String(e).split("\n")[0].slice(0, 300) });
    console.log(`!! ${name}: ${String(e).split("\n")[0].slice(0, 200)}`);
  }
  if (errs.length) notes.push({ name, errs: [...new Set(errs)].slice(0, 5) });
  await ctx.close();
  console.log(`done ${name}`);
}

const tk = await token();
const bnbTk = await token("bnb@torionline.test");

// 1. Appointments list view + cancelled filter (checks the dark-theme pill leftovers)
await session({
  route: "/dashboard/appointments", name: "appts-list", tk,
  steps: async (page, shot) => {
    await page.getByRole("button", { name: /רשימה/ }).click();
    await page.waitForTimeout(700);
    await shot("list");
    // filter tabs
    const tabs = await page.locator("button").filter({ hasText: /בוטלו|בוטל/ }).all();
    if (tabs.length) { await tabs[0].click(); await page.waitForTimeout(700); await shot("cancelled"); }
    const all = await page.locator("button").filter({ hasText: /^הכל$/ }).all();
    if (all.length) { await all[0].click(); await page.waitForTimeout(700); await shot("all"); }
  },
});

// 2. New-appointment modal + empty submit
await session({
  route: "/dashboard/appointments", name: "appts-modal", tk,
  steps: async (page, shot) => {
    await page.getByRole("button", { name: /תור חדש/ }).click();
    await page.waitForTimeout(700);
    await shot("open");
    const submit = page.locator("form button[type=submit], button").filter({ hasText: /^(קבע|שמור|צור|הוסף)/ });
    if (await submit.count()) { await submit.first().click(); await page.waitForTimeout(900); await shot("empty-submit"); }
  },
});

// 3. Services: add + edit modal
await session({
  route: "/dashboard/services", name: "services", tk,
  steps: async (page, shot) => {
    await shot("page");
    const add = page.locator("button").filter({ hasText: /הוספת שירות|שירות חדש|הוסף/ });
    if (await add.count()) { await add.first().click(); await page.waitForTimeout(700); await shot("add-open"); }
    const save = page.locator("button").filter({ hasText: /^(שמור|הוסף)/ });
    if (await save.count()) { await save.first().click(); await page.waitForTimeout(900); await shot("empty-submit"); }
  },
});

// 4. Customers: open a conversation
await session({
  route: "/dashboard/customers", name: "customers", tk,
  steps: async (page, shot) => {
    await shot("page");
    const row = page.locator("button, tr, li").filter({ hasText: /נועה לוי/ });
    if (await row.count()) { await row.first().click(); await page.waitForTimeout(1200); await shot("convo"); }
  },
});

// 5. Hours page zoom (checkbox squeeze) — mobile
await session({
  route: "/dashboard/hours", name: "hours", tk, mobile: true,
  steps: async (page, shot) => { await shot("mobile"); },
});

// 6. Mobile nav "more" sheet
await session({
  route: "/dashboard/analytics", name: "mobilenav", tk, mobile: true,
  steps: async (page, shot) => {
    await shot("home");
    const more = page.locator("button").filter({ hasText: /עוד|More/ });
    if (await more.count()) { await more.last().click(); await page.waitForTimeout(600); await shot("more-open"); }
  },
});

// 7. Empty states — brand-new business with no data at all
for (const [route, nm] of [["/dashboard/analytics", "empty-analytics"], ["/dashboard/appointments", "empty-appts"],
                            ["/dashboard/services", "empty-services"], ["/dashboard/customers", "empty-customers"],
                            ["/dashboard/hours", "empty-hours"], ["/dashboard/billing", "empty-billing"]]) {
  await session({ route, name: nm, tk: bnbTk, steps: async (page, shot) => { await shot("view"); } });
}

// 8. Login validation + wrong credentials
await session({
  route: "/login", name: "login-validation", tk: null,
  steps: async (page, shot) => {
    await page.getByRole("button", { name: /כניסה לחשבון/ }).click();
    await page.waitForTimeout(600);
    await shot("empty-submit");
    await page.locator("input[type=email]").fill("nope@example.com");
    await page.locator("input[type=password]").fill("wrongpassword");
    await page.getByRole("button", { name: /כניסה לחשבון/ }).click();
    await page.waitForTimeout(1500);
    await shot("bad-creds");
  },
});

// 9. API failure — how does the dashboard surface a 500?
await session({
  route: "/dashboard/services", name: "api-500", tk,
  steps: async (page, shot) => {
    await page.route("**/api/business/**", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await shot("view");
  },
});

// 10. Offline / network-down
await session({
  route: "/dashboard/customers", name: "api-offline", tk,
  steps: async (page, shot) => {
    await page.route("**/api/**", (r) => r.abort("failed"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await shot("view");
  },
});

// 11. Keyboard focus visibility on a data page
await session({
  route: "/dashboard/services", name: "keyboard", tk,
  steps: async (page, shot) => {
    for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); await page.waitForTimeout(120); }
    await shot("tab6");
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tag: el.tagName, text: (el.textContent || "").trim().slice(0, 40), cls: (el.getAttribute("class") || "").slice(0, 60) } : null;
    });
    notes.push({ name: "keyboard", focusedAfter6Tabs: focused });
  },
});

await browser.close();
fs.writeFileSync(`${OUT}/interact-notes.json`, JSON.stringify(notes, null, 2));
console.log("\n=== NOTES ===");
console.log(JSON.stringify(notes, null, 2).slice(0, 4000));
