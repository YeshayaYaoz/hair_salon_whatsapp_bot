import fs from "node:fs";
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
const OUT = process.env.QA_OUT ?? "./qa-out";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

for (const [route, slug] of [["/login", "login"], ["/", "landing-he"], ["/en", "landing-en"]]) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    javaScriptEnabled: false,
    timezoneId: "Asia/Jerusalem",
  });
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000" + route, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(800);
  // What did the browser actually parse out of the inline <style>?
  const css = await page.evaluate(() => {
    const out = [];
    for (const sheet of document.styleSheets) {
      if (sheet.ownerNode && sheet.ownerNode.tagName === "STYLE") {
        try {
          const rules = [...sheet.cssRules].map((r) => r.cssText);
          out.push({ ruleCount: rules.length, sample: rules.filter((r) => /font-family|content|::before/.test(r)).slice(0, 6) });
        } catch (e) { out.push({ err: String(e) }); }
      }
    }
    return out;
  });
  console.log(`\n### ${route} (JS off) — parsed inline stylesheets:`);
  console.log(JSON.stringify(css, null, 1).slice(0, 1500));
  await page.screenshot({ path: `${OUT}/nojs-${slug}.png`, fullPage: false });
  await ctx.close();
}
await browser.close();
console.log("\ndone");
