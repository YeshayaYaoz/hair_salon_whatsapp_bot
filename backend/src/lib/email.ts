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
    from: "תורי <onboarding@resend.dev>",
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

export async function sendWelcomeEmail(to: string, name: string) {
  await resendSend({
    from: "תורי <onboarding@resend.dev>",
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
