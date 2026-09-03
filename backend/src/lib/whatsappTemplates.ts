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
// "_2" is not a version bump for fun. The original name is unusable: its rejected template was
// deleted, and Meta blocks a deleted template's name from reuse — the API answers "content is being
// deleted, try again in less than 1 minute" indefinitely (observed 7+ hours), while the real block
// is on the order of weeks. No WABA holds an approved template under the old name (both live WABAs
// were checked), so the rename strands nothing; sending and submission both read this constant.
const DEFAULT_REMINDER_NAME = "tori_appointment_reminder_2";
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
// Opens with "היי" rather than the variable. Meta rejects a body that starts or ends with a
// parameter — a "dangling parameter" — so the previous "{{1}}, תודה שביקרת…" could never have been
// approved, and the review requests it backs would have gone undelivered to anyone outside the 24h
// window with no error anyone would see.

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


const DEFAULT_OWNER_ALERT_NAME = "tori_owner_alert";

/**
 * Reaches the owner when the owner's own 24h window is shut.
 *
 * Owners are the users least likely to have an open window: they never message their own bot. A
 * live call collected a complete lead, the alert was sent free-form, Meta accepted it with a 200
 * and dropped it in transit (131047), and the owner was told a message had been sent. Without this
 * template the fallback is email, which arrives — but hours later, and a lead goes cold.
 *
 * Read from WHATSAPP_OWNER_ALERT_TEMPLATE by ownerNotify.ts; this only names the default so the
 * automatic submission at connect creates the same one the sender looks for.
 */
export function ownerAlertTemplate(): TemplateConfig {
  return { name: process.env.WHATSAPP_OWNER_ALERT_TEMPLATE || DEFAULT_OWNER_ALERT_NAME, languageCode: DEFAULT_LANG };
}

// Text on both sides of the parameter, not just before it. Meta rejects a body that starts *or*
// ends with one, and this template is the hardest case in the file: the whole alert arrives as a
// single variable, so a bare "{{1}}" is both. The closing sentence is the price of that.

/**
 * The same four templates, worded for the kind of business sending them.
 *
 * A zimmer has no "תור" and sells no "תספורת". Sending a guest "התור שלך לתספורת נקבע" reads as a
 * message delivered to the wrong person, and Meta reviews a template against the business it is
 * submitted for — wording that does not match the vertical is the kind of mismatch that comes back
 * INVALID_FORMAT, which is exactly what the zimmer's reminder template did.
 *
 * Names and variable ORDER are identical across variants, deliberately: the sending code passes
 * positional parameters and knows nothing about wording, so only the text may differ. A variant
 * that reorders variables would send the guest's name where the date belongs.
 */
export interface TemplateText {
  body: string;
  example: string[];
}

export interface TemplateWording {
  reminder: TemplateText;
  review: TemplateText;
  confirmation: TemplateText;
}

/**
 * Appointments: salons, barbers, aesthetics, clinics.
 *
 * Each body opens with text rather than a variable — Meta rejects a body that starts or ends with
 * one, a "dangling parameter", and the review body once did exactly that.
 */
const APPOINTMENT_WORDING: TemplateWording = {
  reminder: {
    body: 'שלום {{1}}! תזכורת לתור שלך ל{{2}} ב-{{3}} אצל {{4}}. לביטול יש להשיב "בטל תור".',
    example: ["נועה", "תספורת", "מחר ב-14:30", "מספרת רונית"],
  },
  review: {
    body: "היי {{1}}, תודה שביקרת ב{{2}} היום. נשמח לשמוע איך היה ה{{3}} שלך.",
    example: ["נועה", "מספרת רונית", "תספורת"],
  },
  confirmation: {
    body: 'שלום {{1}}, התור שלך ל{{2}} נקבע ל-{{3}} אצל {{4}}. לביטול יש להשיב "בטל תור".',
    example: ["נועה", "תספורת", "יום שלישי 12.8 בשעה 14:30", "מספרת רונית"],
  },
};

/** Overnight stays: zimmers and B&Bs. Bookings and guests, not appointments and clients. */
const STAY_WORDING: TemplateWording = {
  reminder: {
    body: 'שלום {{1}}! מזכירים את האירוח שלכם ב{{2}} בתאריך {{3}} ב{{4}}. לביטול יש להשיב "בטל הזמנה".',
    example: ["דנה", "סוויטת הגליל", "שישי 15.8", "צימר בנחת רוח"],
  },
  review: {
    // "…השהות ב{{3}}." was rejected: Meta counts a variable as ending the body even with
    // punctuation after it, so trailing "." does not save it. The appointment variant survived only
    // because it happens to end "…ה{{3}} שלך."
    body: "היי {{1}}, תודה שהתארחתם ב{{2}}. נשמח לשמוע איך הייתה השהות ב{{3}} שלכם.",
    example: ["דנה", "צימר בנחת רוח", "סוויטת הגליל"],
  },
  confirmation: {
    body: 'שלום {{1}}, ההזמנה שלכם ל{{2}} אושרה לתאריך {{3}} ב{{4}}. לביטול יש להשיב "בטל הזמנה".',
    example: ["דנה", "סוויטת הגליל", "שישי 15.8, צ׳ק-אין מ-15:00", "צימר בנחת רוח"],
  },
};

/**
 * The owner alert has one wording for everyone: it goes to the business owner, not to a customer,
 * and carries the whole alert in a single variable — there is no domain vocabulary in it to get
 * wrong.
 *
 * Text on both sides of the parameter, not just before it. This is the hardest case in the file:
 * a bare "{{1}}" both starts and ends the body, which Meta rejects twice over. The closing
 * sentence is the price of that.
 */
const OWNER_ALERT_BODY: TemplateText = {
  body: "התראה חדשה מתורי: {{1}} — כל הפרטים מחכים לך בדשבורד.",
  example: ["נועה כהן מעוניינת בתספורת ביום שלישי"],
};

const WORDING_BY_BUSINESS_TYPE: Record<string, TemplateWording> = {
  salon: APPOINTMENT_WORDING,
  barber: APPOINTMENT_WORDING,
  aesthetics: APPOINTMENT_WORDING,
  clinic: APPOINTMENT_WORDING,
  bnb: STAY_WORDING,
};

/**
 * Wording for a business type. Unknown or unset falls back to appointments, which is what most
 * businesses are — and a template in slightly generic Hebrew still delivers, while no template at
 * all delivers nothing.
 */
export function wordingFor(businessType?: string | null): TemplateWording {
  return (businessType && WORDING_BY_BUSINESS_TYPE[businessType]) || APPOINTMENT_WORDING;
}

export const OWNER_ALERT_TEXT = OWNER_ALERT_BODY;

/** Every wording variant, for tests that must cover all of them rather than only the default. */
export const ALL_WORDINGS: Array<[string, TemplateWording]> = [
  ["appointment", APPOINTMENT_WORDING],
  ["stay", STAY_WORDING],
];

export const REMINDER_TEMPLATE_BODY = APPOINTMENT_WORDING.reminder.body;
export const REVIEW_TEMPLATE_BODY = APPOINTMENT_WORDING.review.body;
export const CONFIRMATION_TEMPLATE_BODY = APPOINTMENT_WORDING.confirmation.body;
export const OWNER_ALERT_TEMPLATE_BODY = OWNER_ALERT_BODY.body;

/**
 * Sample values Meta shows its reviewer, one per {{n}} in the matching body.
 *
 * Not decoration and not optional: a template containing variables is rejected outright without
 * them. The reviewer reads the body with these substituted in, so they have to look like the real
 * thing — a plausible Hebrew name and a real-looking date, not "x" and "123", which reads as a test
 * template and gets treated as one.
 */
export const REMINDER_TEMPLATE_EXAMPLE = APPOINTMENT_WORDING.reminder.example;
export const REVIEW_TEMPLATE_EXAMPLE = APPOINTMENT_WORDING.review.example;
export const CONFIRMATION_TEMPLATE_EXAMPLE = APPOINTMENT_WORDING.confirmation.example;
export const OWNER_ALERT_TEMPLATE_EXAMPLE = OWNER_ALERT_BODY.example;

const DEFAULT_OUTREACH_NAME = "tori_outreach_intro";

/**
 * Cold outreach from Tori's own number to a business that has never messaged us.
 *
 * The only MARKETING template here, and the category is not a label — it is the rule set. A cold
 * recipient has no open 24-hour window, so free-form text to them is refused outright (131047), and
 * Meta holds marketing to opt-out requirements that utility messages do not carry. Sending this as
 * UTILITY to dodge that would be reclassified by Meta anyway, and repeated attempts are what drives
 * a number's quality rating down until sending is throttled — on the number the whole outreach
 * channel depends on.
 *
 * Which is also why this lives on Tori's own WABA and never on a customer's: outreach collects
 * blocks and spam reports by its nature, and a salon's number has paying customers to serve.
 */
export function outreachTemplate(): TemplateConfig {
  return { name: process.env.TORI_OUTREACH_TEMPLATE_NAME || DEFAULT_OUTREACH_NAME, languageCode: DEFAULT_LANG };
}

/**
 * {{1}} the business's name.
 *
 * Constraints this body is shaped by, each of which is a rejection if broken: it may not open or
 * close with a variable, the variable has whitespace on both sides so it reads as a substitution
 * rather than a fused word, and it says plainly who is writing and why — an anonymous opener is the
 * most common reason cold Hebrew marketing templates come back rejected.
 */
export const OUTREACH_TEMPLATE_BODY =
  "היי, כאן תורי אונליין. בנינו עוזר חכם שעונה ללקוחות של {{1}} בוואטסאפ ובטלפון, קובע תורים ומעדכן את היומן — גם אחרי שעות הפעילות וגם כשאתם באמצע עבודה. אפשר לשלוח פרטים קצרים?";

export const OUTREACH_TEMPLATE_EXAMPLE = ["מספרת רונית"];

/**
 * The opt-out, in the footer and again as a button.
 *
 * Both, because they fail differently: the button is one tap and is what most people will use, and
 * the footer still reads as an opt-out for anyone whose client renders buttons poorly. Meta weighs
 * a visible, easy opt-out when reviewing marketing templates, and every block avoided is quality
 * rating kept.
 */
export const OUTREACH_TEMPLATE_FOOTER = "לא רלוונטי? השיבו הסר ולא נפנה שוב.";
export const OUTREACH_TEMPLATE_BUTTONS = ["הסירו אותי"];

const DEFAULT_ANNOUNCE_NAME = "tori_product_update_manage";

/**
 * Product announcement to businesses already on Tori — not cold outreach.
 *
 * Separate from the outreach template even though both are MARKETING and both go out from Tori's
 * own number, because they are answerable to different things. Outreach reaches strangers and its
 * wording is tuned to not read as spam; this reaches paying customers, and its job is to get them
 * to try one specific thing. Sharing one template would mean every future announcement re-enters
 * review with the cold opener still attached.
 *
 * Still MARKETING: the recipient has no open 24-hour window (an owner who last messaged us in
 * March), and dressing a feature announcement as UTILITY is the reclassification that costs a
 * number its quality rating.
 */
export function announceTemplate(): TemplateConfig {
  return { name: process.env.TORI_ANNOUNCE_TEMPLATE_NAME || DEFAULT_ANNOUNCE_NAME, languageCode: DEFAULT_LANG };
}

/**
 * {{1}} the business's name.
 *
 * The whole message is one idea — the management happens in WhatsApp — because a template that
 * lists four features gets skimmed and none of them get tried. The example instruction at the end
 * is deliberate: an owner who reads this and does nothing has not learned anything, and "send this
 * exact sentence to your own number" is the shortest path from reading to using.
 */
export const ANNOUNCE_TEMPLATE_BODY =
  "היי, כאן תורי אונליין. מהיום אפשר לנהל את {{1}} ישירות מתוך וואטסאפ — לשנות שעות ומחירים, לראות מי מגיע היום, לחסום זמן ולהוסיף לקוחות. בלי להיכנס לשום מקום: פשוט שולחים הודעה למספר הוואטסאפ של העסק, מהמספר של המנהל, וכותבים מה רוצים. לניסיון ראשון שלחו לעצמכם: מה יש לי היום?";

export const ANNOUNCE_TEMPLATE_EXAMPLE = ["מספרת רונית"];

export const ANNOUNCE_TEMPLATE_FOOTER = "לא רוצים עדכונים כאלה? השיבו הסר.";

/**
 * A link button rather than a quick reply, and only one kind of button on this template.
 *
 * The link lands on the notification-phone field itself, not the top of Settings: an owner with no
 * manager number saved cannot use any of what this message describes, and "open Settings" on a page
 * of six sections is where that owner stops. The opt-out stays in the footer — mixing reply and CTA
 * buttons is a rejection risk that reads like a wording problem.
 */
export const ANNOUNCE_TEMPLATE_BUTTON = {
  text: "הגדרת מספר המנהל",
  url: `${(process.env.APP_URL ?? "https://torionline.com").replace(/\/$/, "")}/dashboard/settings#manager-phone`,
};

const DEFAULT_ANNOUNCE_UTILITY_NAME = "tori_service_update_manage";

/**
 * The same announcement as a UTILITY template.
 *
 * Exists because the MARKETING one is undeliverable to a large part of the audience and says so
 * nowhere: Meta drops a marketing template for any recipient who has opted out of marketing —
 * silently, with a 200 from the send endpoint and no failure webhook. That was measured, not
 * assumed: on one number the MARKETING announcement never arrived while a UTILITY template sent
 * moments later did.
 *
 * The category is honest rather than a workaround. This tells a paying customer that a capability
 * of the service they already pay for now exists, and how to use it — a service update about their
 * own account. What makes it utility is the content, so the wording carries no offer, no pitch and
 * no cold opener; a promotional sentence here would be reclassified by Meta and rightly so.
 */
export function announceUtilityTemplate(): TemplateConfig {
  return {
    name: process.env.TORI_ANNOUNCE_UTILITY_TEMPLATE_NAME || DEFAULT_ANNOUNCE_UTILITY_NAME,
    languageCode: DEFAULT_LANG,
  };
}

/** {{1}} the business's name. Opens as an account notice, not an introduction. */
export const ANNOUNCE_UTILITY_TEMPLATE_BODY =
  "עדכון שירות עבור {{1}}: מהיום אפשר לנהל את העסק ישירות מהוואטסאפ — לעדכן שעות ומחירים, לראות את היומן, לחסום זמן ולהוסיף לקוחות. שולחים הודעה למספר הוואטסאפ של העסק, מהמספר של המנהל, וכותבים מה צריך. לבדיקה מהירה שלחו לעצמכם: מה יש לי היום?";

export const ANNOUNCE_UTILITY_TEMPLATE_EXAMPLE = ["מספרת רונית"];

/**
 * No footer, deliberately.
 *
 * The marketing variant carries an opt-out line because Meta requires one there. Repeating it on a
 * utility template invites exactly the reclassification this variant exists to avoid — an opt-out
 * is the shape of marketing, and a reviewer reads the whole message.
 */
export const ANNOUNCE_UTILITY_TEMPLATE_BUTTON = {
  text: "הגדרת מספר המנהל",
  url: `${(process.env.APP_URL ?? "https://torionline.com").replace(/\/$/, "")}/dashboard/settings#manager-phone`,
};

const DASHBOARD_URL = `${(process.env.APP_URL ?? "https://torionline.com").replace(/\/$/, "")}/dashboard`;

const DEFAULT_OWNER_ALERT_CTA_NAME = "tori_owner_alert_cta";

/**
 * The owner alert again, with a button.
 *
 * The original ends "כל הפרטים מחכים לך בדשבורד" and then leaves the owner to find it — on a phone,
 * from a notification, that is a browser, a bookmark and a login away, and the alert that most
 * needs acting on is the one read while standing at a chair with a client in it. A tap is the
 * whole difference.
 *
 * A separate name rather than an edit: an approved template's wording and buttons are frozen, and
 * changing them means delete-and-resubmit — which tombstones the old name at Meta. Both exist, the
 * old one stays as the fallback for a business whose WABA has not filed this one yet.
 */
export function ownerAlertCtaTemplate(): TemplateConfig {
  return {
    name: process.env.WHATSAPP_OWNER_ALERT_CTA_TEMPLATE || DEFAULT_OWNER_ALERT_CTA_NAME,
    languageCode: DEFAULT_LANG,
  };
}

/** {{1}} the alert itself. Opens with text so the body does not start on a variable. */
export const OWNER_ALERT_CTA_BODY = "יש לך עדכון חדש בתורי: {{1}}";
export const OWNER_ALERT_CTA_EXAMPLE = ["נועה כהן מעוניינת בתספורת ביום שלישי"];
export const OWNER_ALERT_CTA_BUTTON = { text: "פתיחת הדשבורד", url: DASHBOARD_URL };

const DEFAULT_PAYMENT_DETAILS_NAME = "tori_payment_details";

/**
 * Asks the owner to complete their payment details.
 *
 * Unambiguously UTILITY, and worth being precise about why after the announcement templates were
 * reclassified: Meta's line is not who the recipient is but what the message does. An announcement
 * tells someone about a capability — marketing, however service-like the wording. This one asks
 * for an action on the recipient's own account, with a consequence for that account if it is not
 * taken. That is the definition of a utility message, and it is why this one carries a link that
 * the announcement could not.
 */
export function paymentDetailsTemplate(): TemplateConfig {
  return {
    name: process.env.WHATSAPP_PAYMENT_DETAILS_TEMPLATE || DEFAULT_PAYMENT_DETAILS_NAME,
    languageCode: DEFAULT_LANG,
  };
}

/**
 * {{1}} the business's name.
 *
 * Shaped the way every large AI vendor does it: the card is stored, the prices are published, and
 * there is no quote in the loop. So the message asks for one thing and does not negotiate — no
 * figure, no plan comparison, no "talk to us". Naming a price here would also invite exactly the
 * reply this template cannot receive, since a template opens no conversation the owner is in.
 *
 * No urgency language and no invented deadline either. What is true is that a card has not been
 * saved and it takes a minute; a consequence the product does not actually carry out would be both
 * a lie and, in Meta's reading, promotional pressure on a utility message.
 */
export const PAYMENT_DETAILS_BODY =
  "היי {{1}}, נשאר רק לשמור אמצעי תשלום בחשבון תורי. המחירים מפורסמים באתר, והכרטיס נשמר אצל חברת הסליקה ולא אצלנו. שמירה בקישור למטה, פחות מדקה.";

export const PAYMENT_DETAILS_EXAMPLE = ["מספרת רונית"];
export const PAYMENT_DETAILS_BUTTON = { text: "השלמת פרטי תשלום", url: `${DASHBOARD_URL}/billing` };
