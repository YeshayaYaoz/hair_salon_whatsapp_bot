"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { useLanguage } from "./LanguageContext";

/**
 * "Your bot already works" — for a business that has not connected a number of its own.
 *
 * Connecting WhatsApp means Meta's verification, and that can take days. Until it comes through
 * the business runs from Tori's shared line: this link opens WhatsApp on Tori's number with the
 * business's name and code in the first message, and from then on the customer is this
 * business's customer (backend sharedLineRouting.ts). The card disappears the moment a number of
 * their own is connected, and shows nothing when the deployment has no shared number.
 */
export function SharedLineCard() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiFetch<{ active: boolean; link: string | null }>("/api/business/me/shared-line")
      .then((r) => setLink(r.active ? r.link : null))
      .catch(() => setLink(null));
  }, []);

  if (!link) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the field below is selectable either way */
    }
  }

  const shareText = he
    ? `לקביעת תור בוואטסאפ, כתבו לנו כאן: ${link}`
    : `Book over WhatsApp here: ${link}`;

  return (
    <div className="bg-[#E7F8F2] border border-[#BFEBDB] rounded-xl p-6 mb-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-[#128C7E] text-white flex-shrink-0 mt-0.5">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 01-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 00-.7.3 3 3 0 00-.9 2.2 5.2 5.2 0 001.1 2.8 12 12 0 004.6 4c.6.3 1.1.4 1.5.5a3.6 3.6 0 001.6.1 2.7 2.7 0 001.8-1.3 2.2 2.2 0 00.2-1.3c-.1-.1-.3-.2-.5-.3z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-gray-900">
            {he ? "הבוט שלכם כבר עובד — על הקו של תורי" : "Your bot already works — on Tori's line"}
          </h2>
          <p className="text-sm text-gray-700 mt-1">
            {he
              ? "לא צריך לחכות לאישור של מטא. שלחו ללקוחות את הקישור הזה: הוא פותח וואטסאפ עם המספר של תורי, ומהרגע שהם כותבים, הבוט עונה בשם העסק שלכם וקובע תורים ביומן שלכם. כשתחברו מספר משלכם, הכל עובר אליו."
              : "No need to wait for Meta. Send customers this link: it opens WhatsApp on Tori's number, and from their first message the bot answers for your business and books into your calendar. When you connect a number of your own, everything moves to it."}
          </p>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <input
              readOnly
              value={link}
              dir="ltr"
              onFocus={(e) => e.currentTarget.select()}
              className="text-xs flex-1 min-w-[220px] bg-white"
              aria-label={he ? "קישור לקביעת תור בוואטסאפ" : "WhatsApp booking link"}
            />
            <button
              type="button"
              onClick={copy}
              className="text-xs font-semibold px-3 py-2 rounded-lg bg-[#128C7E] text-white hover:bg-[#0f7a6d] transition whitespace-nowrap"
            >
              {copied ? (he ? "הועתק ✓" : "Copied ✓") : he ? "העתקת הקישור" : "Copy link"}
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold px-3 py-2 rounded-lg bg-white text-[#128C7E] border border-[#BFEBDB] hover:bg-[#d8f3e9] transition whitespace-nowrap"
            >
              {he ? "שיתוף בוואטסאפ" : "Share on WhatsApp"}
            </a>
          </div>
          <p className="text-xs text-gray-600 mt-2">
            {he
              ? "שימו אותו בביו באינסטגרם, בפרופיל בגוגל ובסטטוס. לקוח שכתב פעם אחת לא צריך את הקישור שוב — הבוט זוכר אותו 90 יום."
              : "Put it in your Instagram bio, your Google profile and your status. A customer who wrote once needs no link again — the bot remembers them for 90 days."}
          </p>
        </div>
      </div>
    </div>
  );
}
