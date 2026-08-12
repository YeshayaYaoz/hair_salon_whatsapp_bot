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
 *   e.g. "שלום {{1}}! תזכורת לתור שלך ל{{2}} מחר ב-{{3}} אצל {{4}}. לביטול יש להשיב \"בטל תור\"."
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
const DEFAULT_REMINDER_NAME = "tori_appointment_reminder";
const DEFAULT_REVIEW_NAME = "tori_review_request";

/** Returns the reminder template config. Falls back to the default name if not overridden via env. */
export function reminderTemplate(): TemplateConfig {
  return { name: process.env.WHATSAPP_REMINDER_TEMPLATE || DEFAULT_REMINDER_NAME, languageCode: DEFAULT_LANG };
}

/** Returns the review-request template config. Falls back to the default name if not overridden via env. */
export function reviewTemplate(): TemplateConfig {
  return { name: process.env.WHATSAPP_REVIEW_TEMPLATE || DEFAULT_REVIEW_NAME, languageCode: DEFAULT_LANG };
}

/**
 * The literal template bodies submitted to Meta for approval — must stay in sync with the
 * {{n}} variable order documented above and with the bodyParams arrays passed by
 * scheduledMessages.ts. Category UTILITY (not MARKETING) since these are transactional
 * appointment notices, which face much less restrictive delivery/opt-in rules under Meta's
 * policy and Israeli marketing-communications law alike.
 *
 * NOTE ON EDITING THESE STRINGS: the approved body text lives at Meta, not here — sending only
 * passes the template name and params. So a change here applies to templates created from now on;
 * businesses whose template Meta already approved keep the old wording until it is resubmitted.
 * Sending is unaffected either way (name and variable order are what must match), so the two can
 * safely diverge, but don't assume an edit here reaches existing businesses.
 */
export const REMINDER_TEMPLATE_BODY =
  'שלום {{1}}! תזכורת לתור שלך ל{{2}} ב-{{3}} אצל {{4}}. לביטול יש להשיב "בטל תור".';
// Opens with "היי" rather than the variable. Meta rejects a body that starts or ends with a
// parameter — a "dangling parameter" — so the previous "{{1}}, תודה שביקרת…" could never have been
// approved, and the review requests it backs would have gone undelivered to anyone outside the 24h
// window with no error anyone would see.
export const REVIEW_TEMPLATE_BODY = "היי {{1}}, תודה שביקרת ב{{2}} היום. נשמח לשמוע איך היה ה{{3}} שלך.";

const DEFAULT_CONFIRMATION_NAME = "tori_appointment_confirmation";

/**
 * Confirms a booking to the customer.
 *
 * Needed because a booking made by phone leaves the customer with nothing: the voice agent says the
 * time out loud and hangs up, and the caller has no written record of what was booked, when, or
 * with whom. A WhatsApp booking never had this problem — the bot's own reply is the confirmation —
 * so the gap only appeared once the phone line existed.
 *
 * Body ({{n}} → param index):
 *   {{1}} customer first name
 *   {{2}} service name
 *   {{3}} appointment date/time (localized string)
 *   {{4}} business name
 *
 * Meta's own template library carries an approved Hebrew APPOINTMENT_CONFIRMATION template. Where
 * one exists, point WHATSAPP_CONFIRMATION_TEMPLATE at it rather than submitting this for review:
 * a library template is approved on creation, and cannot be rejected over wording.
 */
export function confirmationTemplate(): TemplateConfig {
  return { name: process.env.WHATSAPP_CONFIRMATION_TEMPLATE || DEFAULT_CONFIRMATION_NAME, languageCode: DEFAULT_LANG };
}

export const CONFIRMATION_TEMPLATE_BODY =
  'שלום {{1}}, התור שלך ל{{2}} נקבע ל-{{3}} אצל {{4}}. לביטול יש להשיב "בטל תור".';
