import { emailLayout, detailTable, callout, button, steps, paragraph, esc } from "./emailLayout.js";

export const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const FROM = "תורי-אונליין <noreply@torionline.com>";

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
    from: FROM,
    to,
    subject: "איפוס סיסמה — תורי-אונליין",
    html: emailLayout({
      heading: "איפוס סיסמה לחשבון שלך",
      body:
        paragraph("קיבלנו בקשה לאיפוס הסיסמה. לחיצה על הכפתור תעביר אותך לבחירת סיסמה חדשה.") +
        button(resetUrl, "בחירת סיסמה חדשה") +
        callout(
          "danger",
          "לא ביקשת לאפס סיסמה?",
          "אפשר להתעלם מההודעה — הסיסמה הנוכחית נשארת בתוקף ואיש לא נכנס לחשבון. אם זה חוזר על עצמו, כדאי להחליף סיסמה."
        ),
      footerNote: "הקישור תקף ל-30 דקות ולשימוש חד-פעמי.",
    }),
  });
}

export async function sendWhatsAppTokenExpiredEmail(to: string, businessName: string) {
  await resendSend({
    from: FROM,
    to,
    subject: "⚠️ חיבור הוואטסאפ נותק — תורי-אונליין",
    html: emailLayout({
      eyebrow: "נדרשת פעולה",
      heading: `חיבור הוואטסאפ של ${esc(businessName)} נותק`,
      body:
        paragraph(
          "אישור הגישה לוואטסאפ פג תוקף, ולכן הבוט <strong>אינו יכול לענות ללקוחות כרגע</strong>. כל הודעה שנשלחת לעסק בינתיים לא מקבלת מענה."
        ) +
        button(`${APP_URL}/dashboard/whatsapp`, "חיבור מחדש") +
        callout("danger", "עד שתחברו מחדש —", "הזמנות חדשות לא ייקלטו. החיבור מחדש לוקח פחות מדקה ולא דורש הגדרות נוספות."),
    }),
  });
}

/** Fire-and-forget signal to the operator (SUPER_ADMIN_EMAIL) — new signups and churn events,
 * so they don't have to keep the admin panel open to notice either. */
export async function sendAdminAlertEmail(subject: string, bodyHtml: string) {
  const adminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (!adminEmail) return; // no admin configured — nothing to alert
  await resendSend({
    from: FROM,
    to: adminEmail,
    subject,
    html: emailLayout({
      heading: subject,
      // Caller-supplied HTML, and the caller is our own admin code — not user input.
      body: paragraph(bodyHtml) + button(`${APP_URL}/dashboard/admin`, "פתיחת פאנל הניהול"),
    }),
  });
}

/** One-off notice from the operator to a specific business's own email — used when the super
 * admin panel's "send message" action has no WhatsApp number to fall back to. */
export async function sendBusinessNoticeEmail(to: string, businessName: string, text: string) {
  await resendSend({
    from: FROM,
    to,
    subject: `הודעה מתורי-אונליין עבור ${businessName}`,
    html: emailLayout({
      heading: "הודעה מצוות תורי-אונליין",
      // Free text typed by the operator: escaped, with newlines kept as line breaks.
      body: paragraph(esc(text).replace(/\n/g, "<br/>")),
    }),
  });
}

/** Sent when a super admin creates a trial account directly from a Lead Finder card — the salon
 * didn't sign themselves up, so instead of a password they get a set-password link (reusing the
 * same token flow as forgot-password) to claim the account. */
export async function sendTrialAccountCreatedEmail(to: string, businessName: string, setPasswordUrl: string) {
  await resendSend({
    from: FROM,
    to,
    subject: `${businessName} — הצטרפות לתורי-אונליין`,
    html: emailLayout({
      heading: "פתחנו לכם חשבון ניסיון",
      body:
        paragraph(
          `כדי להתחיל להשתמש בבוט הוואטסאפ שינהל את התורים של <strong>${esc(businessName)}</strong>, צריך לקבוע סיסמה לחשבון.`
        ) +
        button(setPasswordUrl, "קביעת סיסמה והתחלה") +
        callout("success", "אין התחייבות.", "תקופת הניסיון חינם, ואפשר להפסיק בכל שלב בלי לתת סיבה."),
      footerNote: "הקישור תקף ל-7 ימים.",
    }),
  });
}

/** Sends a Lead Finder outreach email — deliberately plain (no Tori branding chrome) since this is
 * a cold email meant to read as personal correspondence from the sales side, not a product email.
 * Left unstyled on purpose: branded chrome is exactly what makes a cold email read as bulk mail. */
export async function sendOutreachEmail(to: string, subject: string, bodyText: string) {
  const bodyHtml = bodyText
    .split("\n\n")
    .map((para) => `<p style="margin:0 0 14px;">${para.replace(/\n/g, "<br/>")}</p>`)
    .join("");
  await resendSend({
    from: FROM,
    to,
    subject,
    html: `<div dir="rtl" style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:8px;color:#1a1a1a;font-size:14px;line-height:1.6;">${bodyHtml}</div>`,
  });
}

export async function sendEmailVerificationEmail(to: string, verifyUrl: string) {
  await resendSend({
    from: FROM,
    to,
    subject: "אימות כתובת האימייל — תורי-אונליין",
    html: emailLayout({
      heading: "אימות כתובת האימייל",
      body:
        paragraph("כדי שנוכל לשלוח התראות והודעות חשובות על החשבון, צריך לאשר שכתובת האימייל הזו שייכת לכם.") +
        button(verifyUrl, "אימות כתובת האימייל") +
        detailTable("פרטי הבקשה", [{ label: "כתובת האימייל", value: esc(to), mono: true }]) +
        callout("success", "לא נרשמתם לתורי-אונליין?", "אפשר להתעלם מההודעה. בלי האישור הזה לא נשלח לכתובת שום דבר נוסף."),
      footerNote: "הקישור תקף ל-24 שעות.",
    }),
  });
}

export async function sendWelcomeEmail(to: string, name: string) {
  await resendSend({
    from: FROM,
    to,
    subject: "ברוכים הבאים לתורי-אונליין!",
    html: emailLayout({
      headingAccent: `היי ${esc(name)},`,
      heading: "החשבון שלכם מוכן",
      body:
        paragraph("נשארו ארבעה שלבים קצרים עד שהבוט יתחיל לענות ללקוחות שלכם בוואטסאפ:") +
        steps([
          "הוספת השירותים והמחירים",
          "הגדרת שעות פעילות",
          "חיבור מספר וואטסאפ עסקי",
          "הפעלת מנוי",
        ]) +
        button(`${APP_URL}/dashboard/analytics`, "כניסה לדשבורד") +
        callout("success", "לא בטוחים איפה להתחיל?", "הדשבורד מציג את השלבים לפי הסדר ומסמן מה כבר הושלם."),
    }),
  });
}
