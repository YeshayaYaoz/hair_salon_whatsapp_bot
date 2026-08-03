/**
 * Writes every transactional email to .email-preview/ as HTML you can open in a browser.
 *
 * Email templates are the one thing in this codebase with no feedback loop: nobody sees them until
 * a real customer does, and by then a broken layout has already gone out. This renders them all
 * from the same functions production uses — the templates are imported here, not copied — so what
 * you open is what gets sent.
 *
 *   npx tsx scripts/preview-emails.ts
 *
 * Then open .email-preview/index.html. Nothing is sent: RESEND_API_KEY is deliberately cleared, so
 * resendSend logs and returns before making a request.
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

// Must be cleared before importing email.ts, so no sample ever reaches a real inbox.
delete process.env.RESEND_API_KEY;
process.env.APP_URL = "https://torionline.com";

const {
  sendPasswordResetEmail,
  sendWhatsAppTokenExpiredEmail,
  sendEmailVerificationEmail,
  sendWelcomeEmail,
  sendTrialAccountCreatedEmail,
  sendBusinessNoticeEmail,
} = await import("../src/lib/email.js");

const OUT = join(process.cwd(), ".email-preview");
mkdirSync(OUT, { recursive: true });

/** Captures the html each template builds by intercepting the outbound fetch. */
const captured: { name: string; subject: string; html: string }[] = [];
let currentName = "";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string, init: any) => {
  const payload = JSON.parse(init.body);
  captured.push({ name: currentName, subject: payload.subject, html: payload.html });
  return { ok: true, json: async () => ({ id: "preview" }) } as any;
}) as typeof fetch;

// A key is needed for resendSend to get as far as the fetch call above.
process.env.RESEND_API_KEY = "preview-only-not-a-real-key";

async function capture(name: string, fn: () => Promise<void>) {
  currentName = name;
  await fn();
}

await capture("welcome", () => sendWelcomeEmail("owner@example.com", "ישעיה"));
await capture("verify-email", () => sendEmailVerificationEmail("owner@example.com", "https://torionline.com/verify-email?token=sample"));
await capture("password-reset", () => sendPasswordResetEmail("owner@example.com", "https://torionline.com/reset-password?token=sample"));
await capture("whatsapp-disconnected", () => sendWhatsAppTokenExpiredEmail("owner@example.com", 'צימרים בנחת רוח'));
await capture("trial-account", () => sendTrialAccountCreatedEmail("owner@example.com", "מספרת שיר", "https://torionline.com/reset-password?token=sample"));
await capture("business-notice", () => sendBusinessNoticeEmail("owner@example.com", "צימרים בנחת רוח", "שלום,\nהעלינו את מכסת ההודעות בחשבון שלכם.\n\nבהצלחה!"));

globalThis.fetch = realFetch;

for (const mail of captured) {
  writeFileSync(join(OUT, `${mail.name}.html`), mail.html, "utf8");
}

const index = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>Tori email previews</title></head>
<body style="margin:0;padding:32px;background:#F4F6F8;font-family:'Segoe UI',Arial,sans-serif;">
  <h1 style="font-size:20px;color:#14202B;">תצוגה מקדימה של המיילים</h1>
  <ul style="line-height:2.2;font-size:15px;">
    ${captured.map((m) => `<li><a href="./${m.name}.html" style="color:#1B7FA0;">${m.name}</a> — <span style="color:#5B6B7A;">${m.subject}</span></li>`).join("")}
  </ul>
</body></html>`;
writeFileSync(join(OUT, "index.html"), index, "utf8");

console.log(`Wrote ${captured.length} previews to ${OUT}`);
for (const m of captured) console.log(`  ${m.name.padEnd(24)} ${m.subject}`);
