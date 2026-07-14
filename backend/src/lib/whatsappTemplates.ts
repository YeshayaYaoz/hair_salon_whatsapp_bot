/**
 * WhatsApp message-template configuration.
 *
 * Free-form messages can only reach a customer within 24 hours of their last inbound message.
 * Appointment reminders and post-visit review requests almost always fall outside that window,
 * so they must be delivered as pre-approved templates. Templates live at the WABA level, and every
 * business connects its own WABA, so the contract is: each business creates templates with these
 * exact names + variable order in Meta Business Manager, and Tori sends against them.
 *
 * The names and language are env-overridable so the convention can change without a redeploy, but
 * the variable ORDER below is the source of truth the approved template body must match.
 *
 * Reminder template body (WHATSAPP_REMINDER_TEMPLATE), {{n}} → param index:
 *   {{1}} customer first name
 *   {{2}} service name
 *   {{3}} appointment date/time (localized string)
 *   {{4}} business name
 *   e.g. "שלום {{1}}! תזכורת לתור שלך ל{{2}} מחר ב-{{3}} אצל {{4}}. לביטול השב/י \"בטל תור\"."
 *
 * Review template body (WHATSAPP_REVIEW_TEMPLATE):
 *   {{1}} customer first name
 *   {{2}} business name
 *   {{3}} service name
 *   e.g. "{{1}}, תודה שביקרת ב{{2}} היום! מקווים שנהנית מה{{3}}."
 *   (A review link is best delivered via a template URL button configured in Meta, not a body
 *    variable — Meta blocks arbitrary URLs in body params.)
 */

export interface TemplateConfig {
  name: string;
  languageCode: string;
}

const DEFAULT_LANG = process.env.WHATSAPP_TEMPLATE_LANG || "he";

/** Returns the reminder template config, or null if no template name is configured. */
export function reminderTemplate(): TemplateConfig | null {
  const name = process.env.WHATSAPP_REMINDER_TEMPLATE;
  return name ? { name, languageCode: DEFAULT_LANG } : null;
}

/** Returns the review-request template config, or null if no template name is configured. */
export function reviewTemplate(): TemplateConfig | null {
  const name = process.env.WHATSAPP_REVIEW_TEMPLATE;
  return name ? { name, languageCode: DEFAULT_LANG } : null;
}
