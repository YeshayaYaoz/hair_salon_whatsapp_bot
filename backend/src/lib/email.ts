export const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function resendSend(payload: { from: string; to: string; subject: string; html: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.error("RESEND_API_KEY not set"); return; }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await res.json() as any;
  if (!res.ok) {
    console.error("Resend error:", body);
    throw new Error(body.message ?? "Resend failed");
  }
  console.log("Email sent, id:", body.id);
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  await resendSend({
    from: "תורי <noreply@torionline.com>",
    to,
    subject: "איפוס סיסמה — תורי",
    html: `
      <div dir="rtl" style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#09090b;color:#e4e4e7;border-radius:12px;">
        <h2 style="color:#fff;margin-bottom:8px;">איפוס סיסמה</h2>
        <p style="color:#a1a1aa;margin-bottom:24px;">קיבלנו בקשה לאיפוס הסיסמה שלך. לחץ על הכפתור למטה:</p>
        <a href="${resetUrl}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">איפוס סיסמה</a>
        <p style="color:#71717a;margin-top:24px;font-size:13px;">הקישור תקף ל-30 דקות. אם לא ביקשת איפוס סיסמה, התעלם מהמייל הזה.</p>
      </div>
    `,
  });
}

export async function sendWhatsAppTokenExpiredEmail(to: string, businessName: string) {
  await resendSend({
    from: "תורי <noreply@torionline.com>",
    to,
    subject: "⚠️ חיבור הוואטסאפ נותק — תורי",
    html: `
      <div dir="rtl" style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#09090b;color:#e4e4e7;border-radius:12px;">
        <h2 style="color:#fff;margin-bottom:8px;">חיבור הוואטסאפ של ${businessName} נותק</h2>
        <p style="color:#a1a1aa;margin-bottom:24px;">אישור הגישה לוואטסאפ פג תוקף, והבוט אינו יכול לשלוח הודעות ללקוחות. יש לחבר מחדש את הוואטסאפ בדשבורד כדי להמשיך לקבל הזמנות.</p>
        <a href="${APP_URL}/dashboard/whatsapp" style="display:inline-block;background:#1B7FA0;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">חיבור מחדש</a>
      </div>
    `,
  });
}

/** Fire-and-forget signal to the operator (SUPER_ADMIN_EMAIL) — new signups and churn events,
 * so they don't have to keep the admin panel open to notice either. */
export async function sendAdminAlertEmail(subject: string, bodyHtml: string) {
  const adminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (!adminEmail) return; // no admin configured — nothing to alert
  await resendSend({
    from: "תורי <noreply@torionline.com>",
    to: adminEmail,
    subject,
    html: `
      <div dir="rtl" style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#09090b;color:#e4e4e7;border-radius:12px;">
        ${bodyHtml}
        <a href="${APP_URL}/dashboard/admin" style="display:inline-block;margin-top:20px;background:#1B7FA0;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:13px;">פתיחת פאנל הניהול</a>
      </div>
    `,
  });
}

/** One-off notice from the operator to a specific business's own email — used when the super
 * admin panel's "send message" action has no WhatsApp number to fall back to. */
export async function sendBusinessNoticeEmail(to: string, businessName: string, text: string) {
  await resendSend({
    from: "תורי <noreply@torionline.com>",
    to,
    subject: `הודעה מ-Tori עבור ${businessName}`,
    html: `
      <div dir="rtl" style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#09090b;color:#e4e4e7;border-radius:12px;">
        <p style="color:#e4e4e7;line-height:1.7;">${text}</p>
      </div>
    `,
  });
}

/** Sent when a super admin creates a trial account directly from a Lead Finder card — the salon
 * didn't sign themselves up, so instead of a password they get a set-password link (reusing the
 * same token flow as forgot-password) to claim the account. */
export async function sendTrialAccountCreatedEmail(to: string, businessName: string, setPasswordUrl: string) {
  await resendSend({
    from: "תורי <noreply@torionline.com>",
    to,
    subject: `${businessName} — הצטרפות לתורי`,
    html: `
      <div dir="rtl" style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#09090b;color:#e4e4e7;border-radius:12px;">
        <h2 style="color:#fff;margin-bottom:8px;">פתחנו לך חשבון ניסיון בתורי!</h2>
        <p style="color:#a1a1aa;margin-bottom:24px;">כדי להתחיל להשתמש בבוט הוואטסאפ שינהל את התורים של ${businessName}, קבע/י סיסמה לחשבון:</p>
        <a href="${setPasswordUrl}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">קביעת סיסמה והתחלה</a>
        <p style="color:#71717a;margin-top:24px;font-size:13px;">הקישור תקף ל-7 ימים.</p>
      </div>
    `,
  });
}

/** Sends a Lead Finder outreach email — deliberately plain (no Tori branding chrome) since this is
 * a cold email meant to read as personal correspondence from the sales side, not a product email. */
export async function sendOutreachEmail(to: string, subject: string, bodyText: string) {
  const bodyHtml = bodyText
    .split("\n\n")
    .map((para) => `<p style="margin:0 0 14px;">${para.replace(/\n/g, "<br/>")}</p>`)
    .join("");
  await resendSend({
    from: "תורי <noreply@torionline.com>",
    to,
    subject,
    html: `<div dir="rtl" style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:8px;color:#1a1a1a;font-size:14px;line-height:1.6;">${bodyHtml}</div>`,
  });
}

export async function sendWelcomeEmail(to: string, name: string) {
  await resendSend({
    from: "תורי <noreply@torionline.com>",
    to,
    subject: "ברוך הבא לתורי!",
    html: `
      <div dir="rtl" style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#09090b;color:#e4e4e7;border-radius:12px;">
        <h2 style="color:#fff;margin-bottom:8px;">ברוך הבא לתורי, ${name}!</h2>
        <p style="color:#a1a1aa;margin-bottom:16px;">החשבון שלך נוצר בהצלחה. הנה מה שצריך לעשות כדי להפעיל את הבוט:</p>
        <ol style="color:#a1a1aa;margin:0 0 24px;padding-right:20px;line-height:2;">
          <li>הוסף שירותים בדשבורד</li>
          <li>הגדר שעות פעילות</li>
          <li>חבר מספר וואטסאפ עסקי</li>
          <li>הפעל מנוי</li>
        </ol>
        <a href="${APP_URL}/dashboard/analytics" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">כניסה לדשבורד</a>
      </div>
    `,
  });
}
