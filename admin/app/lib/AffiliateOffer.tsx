"use client";

import { useState } from "react";
import { apiFetch } from "./api";
import { useLanguage } from "./LanguageContext";

/**
 * Offers a salon that has nothing connected a way to get one — through our PayPlus partner link.
 *
 * Shown only when the relevant provider slot is empty. A salon that already has a provider is
 * never shown this: the point is to unblock owners who are stuck without card payments or without
 * receipts, not to talk anyone out of a provider they already use. That restriction is also what
 * keeps the recommendation honest — the alternative it competes with is "nothing".
 *
 * `ref` carries the businessId because that is the sub-id PayPlus's affiliate dashboard reports
 * back, and the only way to match a signup there to a salon here. It is not sensitive: the same id
 * is already in the salon's own public booking URL (/book/<businessId>).
 *
 * The click is also recorded on our side, so a later connection can be recognised as a conversion
 * and emailed to the operator. That send is best-effort and deliberately never blocks the
 * navigation — the salon is going to PayPlus either way.
 */

const PAYPLUS_AFFILIATE_BASE = "https://aff.pays.plus/b7f28a21-6f53-4af7-a8c3-bdcca408c0ff";

export type AffiliateKind = "payments" | "invoice";

function affiliateUrl(kind: AffiliateKind, businessId: string): string {
  const url = new URL(PAYPLUS_AFFILIATE_BASE);
  url.searchParams.set("ref", businessId);
  // PayPlus's own flag for the invoicing product rather than the clearing one.
  if (kind === "invoice") url.searchParams.set("inv", "true");
  return url.toString();
}

const COPY = {
  payments: {
    he: {
      title: "אין לכם ספק סליקה?",
      body: "בלי ספק סליקה אי אפשר לגבות מקדמות, ותורים שנקבעים לא מאובטחים בכלום. PayPlus הוא הספק שאנחנו ממליצים עליו — פתיחת חשבון לוקחת כמה דקות, וההגדרה כאן היא העתקה של שני מפתחות.",
      cta: "פתיחת חשבון ב-PayPlus",
    },
    en: {
      title: "No payment provider yet?",
      body: "Without one you can't collect deposits, so nothing secures a booking. PayPlus is the provider we recommend — opening an account takes a few minutes, and setup here is copying two keys.",
      cta: "Open a PayPlus account",
    },
  },
  invoice: {
    he: {
      title: "אין לכם ספק חשבוניות?",
      body: "בלי ספק חשבוניות כל קבלה נשלחת ידנית, אחרי כל תשלום. עם חיבור, הקבלה יוצאת אוטומטית ברגע שהלקוח משלם.",
      cta: "פתיחת חשבון חשבוניות ב-PayPlus",
    },
    en: {
      title: "No invoicing provider yet?",
      body: "Without one, every receipt is sent by hand after every payment. Connected, the receipt is issued automatically the moment a customer pays.",
      cta: "Open a PayPlus invoicing account",
    },
  },
} as const;

export function AffiliateOffer({ kind, businessId }: { kind: AffiliateKind; businessId: string | null }) {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [going, setGoing] = useState(false);
  const [open, setOpen] = useState(false);
  const c = COPY[kind][he ? "he" : "en"];

  // Without a businessId there is no attribution to pass, and an unattributed referral is worth
  // less than none — it would show up in the affiliate dashboard with no way to tell who it was.
  if (!businessId) return null;

  async function handleClick() {
    setGoing(true);
    try {
      await apiFetch("/api/business/me/affiliate-click", {
        method: "POST",
        body: JSON.stringify({ provider: "payplus", kind }),
      });
    } catch {
      // Recording the click is bookkeeping for us, not something the salon should ever see fail.
    } finally {
      setGoing(false);
    }
  }

  return (
    /* One line by default, opening to the full pitch. It used to render at full height above each
       provider card, so the payments page led with two blocks of sales copy before the settings
       the owner actually came for. The offer still has to be visible — a salon with no provider
       cannot take deposits at all — so it keeps a permanent line rather than hiding behind a
       toggle, and the affiliate disclosure stays with the link either way. */
    <div className="rounded-xl px-4 py-3 mb-4" style={{ background: "#F0F7FF", border: "1px solid #C7DDF5" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 text-start"
      >
        <span
          className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold text-white"
          style={{ background: "#0F62FE" }}
          aria-hidden
        >
          PP
        </span>
        <h3 className="text-xs font-bold flex-1 min-w-0" style={{ color: "#0B3B7A" }}>{c.title}</h3>
        <span className="text-[11px] font-semibold shrink-0" style={{ color: "#0F62FE" }}>
          {open ? (he ? "סגירה" : "Close") : (he ? "פרטים" : "Details")}
        </span>
      </button>

      {open && (
      <div className="flex items-start gap-3 mt-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-relaxed" style={{ color: "#1F3D63" }}>{c.body}</p>
          <a
            href={affiliateUrl(kind, businessId)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleClick}
            className="inline-flex items-center gap-1.5 mt-3 px-3.5 py-2 rounded-lg text-xs font-semibold text-white transition"
            style={{ background: "#0F62FE", opacity: going ? 0.8 : 1 }}
          >
            {c.cta}
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
          {/* Said plainly rather than buried: the salon should know the recommendation isn't
              disinterested, and saying so costs nothing when the alternative really is nothing.
              #4A6B94 rather than the lighter grey this started as — a disclosure that fails
              contrast is a disclosure in name only. 5.09:1 here, against 4.03:1 before. */}
          <p className="text-[11px] mt-2" style={{ color: "#4A6B94" }}>
            {he ? "קישור שותפים — אנחנו מקבלים עמלה אם תפתחו חשבון. המחיר עבורכם זהה." : "Affiliate link — we earn a commission if you open an account. Your price is the same."}
          </p>
        </div>
      </div>
      )}
    </div>
  );
}
