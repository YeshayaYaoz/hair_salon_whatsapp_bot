/**
 * Turns PayPlus's error codes into something the person reading them can act on.
 *
 * PayPlus answers with kebab-case codes like `dont-have-permission-recurring-payment`. Passed
 * through verbatim they tell an owner nothing, and each of these needs a different fix — one is a
 * phone call to PayPlus, one is a field in our own dashboard, one is a wrong key. Guessing wrong
 * costs a support cycle each time.
 *
 * Anything unrecognised falls through unchanged: a raw code is still better than a generic
 * "payment failed", because it can be searched and quoted to PayPlus support.
 */
const PAYPLUS_ERRORS: { match: RegExp; he: string }[] = [
  {
    match: /dont-have-permission-recurring-payment/i,
    he: "חשבון ה-PayPlus אינו מורשה לחיובים חוזרים (טוקן). זו הרשאה שמופעלת אצל PayPlus — צריך לפנות אליהם ולבקש להפעיל תשלומים חוזרים / שמירת טוקן לחשבון.",
  },
  {
    match: /missing-payment-page-uid|payment-page.*not.*found/i,
    he: "מזהה דף התשלום (Payment Page UID) חסר או שאינו קיים בחשבון. בדקו אותו בממשק PayPlus תחת דפי תשלום.",
  },
  {
    match: /not-authorize|unauthorized|invalid.*(api|key|token)/i,
    he: "מפתחות ה-PayPlus נדחו. ודאו שהם של סביבת הייצור (ולא sandbox) ושהועתקו במלואם.",
  },
  {
    match: /amount/i,
    he: "הסכום שנשלח נדחה על ידי PayPlus. ייתכן שהוא מחוץ לתקרה שהוגדרה לחשבון.",
  },
];

/** Wraps a raw PayPlus failure in a Hebrew explanation, keeping the original code for support. */
export function explainPayPlusError(raw: string): string {
  const known = PAYPLUS_ERRORS.find((e) => e.match.test(raw));
  return known ? `${known.he} (${raw})` : raw;
}
