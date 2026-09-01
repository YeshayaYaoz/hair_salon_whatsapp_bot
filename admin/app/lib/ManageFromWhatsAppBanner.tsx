"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLanguage } from "./LanguageContext";

/**
 * Announces that the business can now be run from inside WhatsApp.
 *
 * The only announcement channel that needs nobody's approval and reaches every owner: email has to
 * be opened, a WhatsApp broadcast needs an approved MARKETING template, and this is simply here on
 * the next login.
 *
 * Dismissal is per browser, in localStorage, keyed by version. Per browser is the honest scope for
 * something with no server-side record — an owner who dismisses it on their phone will see it once
 * more on a laptop, which is a far better failure than storing a "seen" flag on the business and
 * having the second owner of a two-owner salon never see it at all. The version in the key means
 * the next announcement gets its own dismissal rather than inheriting this one's.
 */
const DISMISS_KEY = "tori.announce.manageFromWhatsApp.v1";

// Straight to the field, not to the top of Settings. "Go to Settings" on a page with six sections
// is a scavenger hunt, and the owner who gives up there is exactly the one who never tries the
// feature at all. The Settings page scrolls to and focuses this on arrival.
const MANAGER_PHONE_HREF = "/dashboard/settings#manager-phone";

export function ManageFromWhatsAppBanner({ managerPhoneSet }: { managerPhoneSet: boolean | null }) {
  const { lang } = useLanguage();
  const he = lang === "he";
  // Starts hidden and is revealed by the effect. Rendering it first and hiding it on mount would
  // flash the banner at owners who dismissed it weeks ago, on every single page load.
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(DISMISS_KEY)) setShow(true);
    } catch {
      // Private browsing, or storage blocked. Showing it is the right side to fail on: an
      // announcement seen twice is a smaller cost than one never seen.
      setShow(true);
    }
  }, []);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, new Date().toISOString());
    } catch {
      // Nothing to do — it will reappear next load, which is the same failure as above.
    }
  }

  // Waits for the /me lookup rather than assuming: the two versions of this banner give opposite
  // instructions, and guessing wrong sends an owner to try something that cannot work yet.
  if (!show || managerPhoneSet === null) return null;

  const examples = he
    ? ["מה יש לי היום?", "תשנה יום שלישי ל-10:00 עד 18:00", "תספורת עכשיו 120 שקל", "תחסום לי מחר 14:00-16:00"]
    : ["What's on today?", "Change Tuesday to 10:00–18:00", "Haircut is now 120", "Block tomorrow 14:00–16:00"];

  return (
    <div
      className="relative overflow-hidden rounded-xl mb-5 px-4 py-4 sm:px-5"
      style={{
        background: "linear-gradient(100deg, #075E54 0%, #128C7E 55%, #25D366 100%)",
        boxShadow: "0 6px 20px rgba(18,140,126,0.22)",
      }}
    >
      <div className="pointer-events-none absolute -top-10 -end-10 w-36 h-36 rounded-full" style={{ background: "rgba(255,255,255,0.10)" }} />

      <button
        onClick={dismiss}
        aria-label={he ? "סגירה" : "Dismiss"}
        className="absolute top-3 end-3 w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <div className="flex items-start gap-3.5 pe-8">
        <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center shrink-0 text-lg">💬</div>
        <div className="min-w-0">
          <div className="text-white font-bold text-sm sm:text-base leading-tight">
            {he ? "חדש: נהלו את העסק ישירות מוואטסאפ" : "New: run your business from WhatsApp"}
          </div>
          <div className="text-white/90 text-xs sm:text-sm leading-snug mt-1">
            {he
              ? "בלי להיכנס לכאן. שולחים הודעה למספר הוואטסאפ של העסק, מהמספר של המנהל, וכותבים מה רוצים."
              : "Without opening this dashboard. Message your business's WhatsApp number from the manager's phone and just say what you want."}
          </div>

          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {examples.map((ex) => (
              <span
                key={ex}
                className="text-white text-[11px] sm:text-xs rounded-full px-2.5 py-1 bg-white/15"
                dir={he ? "rtl" : "ltr"}
              >
                {ex}
              </span>
            ))}
          </div>

          {managerPhoneSet ? (
            <>
              <div className="text-white/85 text-[11px] sm:text-xs mt-2.5">
                {he
                  ? "לפני כל שינוי הבוט מקריא מה הוא עומד לעשות ומחכה לאישור. רק המספר של המנהל יכול — הבוט בודק מאיפה נשלחה ההודעה, לא מה כתוב בה."
                  : "The bot reads back every change and waits for your yes. Only the manager's number can do this — it checks who sent the message, not what it claims."}
              </div>
              {/* An owner whose number is already saved needs no setup — the only thing left is to
                  try it. So the primary action is the sentence to send, and the link to the number
                  is secondary, for the one who wants to check which number it is. */}
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <span className="text-white text-xs font-semibold">
                  {he ? "נסו עכשיו — שלחו לבוט שלכם:" : "Try it now — send your bot:"}
                </span>
                <span
                  className="bg-white text-xs font-bold px-3.5 py-1.5 rounded-lg"
                  style={{ color: "#075E54" }}
                  dir={he ? "rtl" : "ltr"}
                >
                  {he ? "מה יש לי היום?" : "What's on today?"}
                </span>
                <Link href={MANAGER_PHONE_HREF} className="text-white/85 text-xs underline underline-offset-2 hover:text-white">
                  {he ? "מאיזה מספר?" : "From which number?"}
                </Link>
              </div>
            </>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <span className="text-white text-xs font-semibold">
                {he ? "עוד לא הגדרתם מספר מנהל — בלעדיו הבוט לא יזהה אתכם." : "No manager number saved yet — without it the bot can't recognise you."}
              </span>
              <Link
                href={MANAGER_PHONE_HREF}
                className="bg-white text-xs font-bold px-3.5 py-1.5 rounded-lg transition hover:bg-white/90"
                style={{ color: "#075E54" }}
              >
                {he ? "הגדרת המספר — 30 שניות" : "Set the number — 30 seconds"}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
