/**
 * One shared visual system for every email Tori sends.
 *
 * Before this, each email hand-rolled its own markup: a dark card (#09090b) with two different
 * accent colours — purple on password-reset and account-created, teal everywhere else — so the
 * product looked like two different companies depending on which message you got. Transactional
 * mail is also where trust is decided: a password reset that doesn't look like the dashboard is a
 * password reset people hesitate to click.
 *
 * The structure follows what Israeli users already recognise from their bank and payment
 * providers: a light neutral page, one white card, a labelled detail table, and colour used only
 * to mean something (green = fine, red = act now). Tori's own teal stays the single brand accent.
 *
 * Email HTML constraints this file works within, none of them optional:
 * - Tables for layout. Outlook renders div-based layouts unpredictably; flex and grid don't exist.
 * - Every style inline. There is no <style> block and no external CSS in most clients.
 * - No background-image, no web fonts, no border-radius on Outlook (it degrades to square, fine).
 * - Fixed 600px width, the widest that survives mobile clients without horizontal scroll.
 */

export const BRAND = {
  /** Tori teal — the single accent. Buttons, links, the logo mark. */
  primary: "#1B7FA0",
  primaryDark: "#145F78",
  /** Page behind the card. A neutral with a slight cool bias so the white card reads as raised. */
  page: "#F4F6F8",
  card: "#FFFFFF",
  border: "#E5E9ED",
  /** Heading text. Not pure black — pure black on white is harsh at email body sizes. */
  text: "#14202B",
  muted: "#5B6B7A",
  faint: "#8A99A6",
  successBg: "#ECFDF5",
  successBorder: "#A7F3D0",
  successText: "#065F46",
  dangerBg: "#FEF2F2",
  dangerBorder: "#FECACA",
  dangerText: "#991B1B",
  eyebrowBg: "#FEF2F2",
  eyebrowText: "#B42318",
} as const;

const FONT = "'Segoe UI', Arial, Helvetica, sans-serif";

/**
 * The same logo the dashboard sidebar shows, so the email and the app read as one product.
 *
 * Served from the admin app's public/ folder. Deliberately NOT APP_URL: that can point at
 * localhost in development, and a localhost image in an email is a broken image in someone's
 * inbox. Emails always reference the production asset. EMAIL_LOGO_URL can override it if the
 * asset ever moves to a CDN.
 *
 * email-logo.png is a trimmed 192px copy of the source logo (26KB rather than 1.2MB) — inbox
 * images load over whatever connection the reader is on, and a slow logo is a header that pops
 * into place after the text.
 */
const LOGO_URL = process.env.EMAIL_LOGO_URL ?? "https://torionline.com/email-logo.png";

/** Escapes text that will be interpolated into HTML. Business names and customer-supplied strings
 * reach these templates, and an unescaped `<` silently breaks the whole layout. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface DetailRow {
  label: string;
  value: string;
  /** Renders the value monospaced — for IPs, ids, tokens, anything meant to be compared visually. */
  mono?: boolean;
}

/**
 * A labelled facts table: grey header strip, then one row per fact with the label on the trailing
 * side. Used wherever the reader needs to check specifics against what they know.
 */
export function detailTable(title: string, rows: DetailRow[]): string {
  const body = rows
    .map(
      (r, i) => `
        <tr>
          <td style="padding:12px 16px;border-top:1px solid ${BRAND.border};font-family:${FONT};font-size:14px;color:${BRAND.text};font-weight:600;${r.mono ? "font-family:'Courier New',monospace;font-size:13px;word-break:break-all;" : ""}" align="right">${r.value}</td>
          <td style="padding:12px 16px;border-top:1px solid ${BRAND.border};font-family:${FONT};font-size:13px;color:${BRAND.muted};white-space:nowrap;" align="left">${r.label}</td>
        </tr>`
    )
    .join("");

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${BRAND.border};border-radius:12px;border-collapse:separate;overflow:hidden;margin:0 0 24px;">
      <tr>
        <td colspan="2" style="padding:10px 16px;background:#F7F9FA;font-family:${FONT};font-size:13px;color:${BRAND.muted};font-weight:600;" align="right">${esc(title)}</td>
      </tr>
      ${body}
    </table>`;
}

/** Green = nothing to do. Red = the reader has to act. Never used decoratively. */
export function callout(kind: "success" | "danger", title: string, bodyHtml: string): string {
  const bg = kind === "success" ? BRAND.successBg : BRAND.dangerBg;
  const border = kind === "success" ? BRAND.successBorder : BRAND.dangerBorder;
  const color = kind === "success" ? BRAND.successText : BRAND.dangerText;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;">
      <tr>
        <td style="padding:14px 16px;background:${bg};border:1px solid ${border};border-radius:12px;font-family:${FONT};font-size:14px;line-height:1.7;color:${color};" align="right">
          <strong>${esc(title)}</strong> ${bodyHtml}
        </td>
      </tr>
    </table>`;
}

/** The single call to action. Bulletproof enough for Outlook without VML: a padded table cell. */
export function button(href: string, label: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;">
      <tr>
        <td style="border-radius:10px;background:${BRAND.primary};" align="center">
          <a href="${href}" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;">${esc(label)}</a>
        </td>
      </tr>
    </table>`;
}

/** An ordered list of next steps, spaced so each reads as its own task. */
export function steps(items: string[]): string {
  return `
    <ol style="margin:0 0 24px;padding:0 20px 0 0;font-family:${FONT};font-size:15px;line-height:2.1;color:${BRAND.muted};" dir="rtl">
      ${items.map((i) => `<li>${esc(i)}</li>`).join("")}
    </ol>`;
}

export function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.75;color:${BRAND.muted};">${html}</p>`;
}

export interface LayoutOptions {
  /** Small pill above the heading — reserved for alerts, so it doesn't lose its meaning. */
  eyebrow?: string;
  /** The heading. Split so a personal name can carry the brand colour, as in "היי ישעיה,". */
  heading: string;
  headingAccent?: string;
  /** Everything between heading and footer — build it from the helpers above. */
  body: string;
  /** Small print under the card: legal, "you received this because…", support contact. */
  footerNote?: string;
}

/**
 * Wraps content in the standard shell: logo, white card, footer.
 *
 * The outer table carries the page background — several clients ignore background colour on <body>
 * entirely, and without it the card floats on whatever the client's default is (often pure white,
 * which erases the card edge).
 */
export function emailLayout({ eyebrow, heading, headingAccent, body, footerNote }: LayoutOptions): string {
  return `<!doctype html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND.page};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.page};padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;">

          <tr>
            <td align="center" style="padding:0 0 22px;">
              <!-- alt text carries the brand when images are blocked, which is the default in
                   Outlook and for many Gmail users on first contact with a sender. -->
              <img src="${LOGO_URL}" width="56" height="56" alt="תורי-אונליין"
                   style="display:block;width:56px;height:56px;border:0;border-radius:12px;font-family:${FONT};font-size:15px;font-weight:800;color:${BRAND.primary};" />
            </td>
          </tr>

          <tr>
            <td style="background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:16px;padding:32px;" dir="rtl">
              ${eyebrow ? `<div style="margin:0 0 16px;"><span style="display:inline-block;padding:5px 12px;background:${BRAND.eyebrowBg};color:${BRAND.eyebrowText};border-radius:999px;font-family:${FONT};font-size:12px;font-weight:700;">${esc(eyebrow)}</span></div>` : ""}
              <h1 style="margin:0 0 12px;font-family:${FONT};font-size:22px;line-height:1.45;font-weight:800;color:${BRAND.text};">
                ${headingAccent ? `<span style="color:${BRAND.primary};">${esc(headingAccent)}</span> ` : ""}${esc(heading)}
              </h1>
              ${body}
            </td>
          </tr>

          <tr>
            <td style="padding:20px 8px 0;" align="center">
              <p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.7;color:${BRAND.faint};">
                תורי-אונליין — ניהול תורים והזמנות בוואטסאפ
              </p>
              ${footerNote ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.7;color:${BRAND.faint};">${footerNote}</p>` : ""}
              <p style="margin:0;font-family:${FONT};font-size:12px;color:${BRAND.faint};">
                <a href="https://torionline.com" style="color:${BRAND.primary};text-decoration:none;">torionline.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
