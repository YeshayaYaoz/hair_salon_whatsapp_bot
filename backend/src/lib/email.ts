import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  await resend.emails.send({
    from: "תורי <noreply@tori.co.il>",
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
