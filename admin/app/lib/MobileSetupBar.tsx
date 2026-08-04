"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiFetch } from "./api";
import { useLanguage } from "./LanguageContext";
import { STEP_META, type SetupStatus } from "./SetupChecklist";

/**
 * Mobile-only "next setup step" bar, pinned above the bottom tab bar on every dashboard page.
 *
 * The mobile tab bar only has room for a handful of destinations, so setup pages — WhatsApp,
 * hours, notification phone, billing — all live behind the "More" sheet. A new owner therefore
 * has to already know what they're looking for and where it hides, which in practice meant
 * someone walking them through it by hand.
 *
 * This surfaces exactly one thing: the next incomplete step, one tap away, wherever they are. It
 * disappears the moment setup is complete, so it never nags an established business. Critical
 * steps are styled amber because a missing WhatsApp connection or notification phone doesn't fail
 * loudly — the product just quietly doesn't work.
 *
 * Two things it is careful about, because it is a fixed bar living outside the page it covers:
 *
 *  - It stays off /dashboard/analytics, which renders the full <SetupChecklist /> inline. Showing
 *    both meant the home screen nagged a new owner twice about the same step, in two different
 *    shapes, one on top of the other.
 *  - It publishes its measured height to --mobile-setup-bar-h so <main> can reserve room for it.
 *    That padding used to be a constant in dashboard/layout.tsx that assumed this bar didn't
 *    exist, so whenever it appeared it silently covered the last ~23px of every page.
 */
export function MobileSetupBar() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const pathname = usePathname();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const barRef = useRef<HTMLAnchorElement | null>(null);

  const suppressed = pathname === "/dashboard/analytics";

  useEffect(() => {
    apiFetch<SetupStatus>("/api/business/me/setup-status")
      .then(setStatus)
      .catch(() => {});
  }, []);

  // Measured rather than hard-coded: the step name wraps to a second line in either language, and
  // a guessed constant is exactly the kind of thing that drifts out of sync with the markup.
  useEffect(() => {
    const el = barRef.current;
    const root = document.documentElement;
    if (!el) {
      root.style.setProperty("--mobile-setup-bar-h", "0px");
      return;
    }
    const publish = () => root.style.setProperty("--mobile-setup-bar-h", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty("--mobile-setup-bar-h", "0px");
    };
    // These are exactly the inputs that decide whether the bar renders at all, so the ref is
    // guaranteed to be current by the time this runs. `lang` is in the list because the step name
    // changes length between Hebrew and English.
  }, [suppressed, status, lang]);

  if (suppressed || !status || status.complete) return null;

  // Critical steps first: an owner who does "add services" before "connect WhatsApp" has a bot
  // that still can't send a single message.
  const next = status.steps.find((s) => !s.done && s.critical) ?? status.steps.find((s) => !s.done);
  const meta = next ? STEP_META[next.key] : undefined;
  if (!next || !meta) return null;

  return (
    <Link
      ref={barRef}
      href={meta.href}
      className="md:hidden fixed bottom-[calc(4rem+var(--safe-b))] start-0 end-0 z-30 flex items-center gap-3 py-2.5 border-t
        pl-[calc(1rem+var(--safe-l))] pr-[calc(1rem+var(--safe-r))]"
      style={{
        background: next.critical ? "#FFFBEB" : "#F3F7FA",
        borderColor: next.critical ? "#FDE68A" : "#E8EEF3",
      }}
    >
      <span
        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold tabular-nums"
        style={{ background: next.critical ? "#F59E0B" : "#1B7FA0", color: "#fff" }}
        aria-hidden
      >
        {status.doneCount + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] leading-tight" style={{ color: "#6B7A88" }}>
          {he
            ? `שלב ${status.doneCount + 1} מתוך ${status.totalCount} להפעלת הבוט`
            : `Step ${status.doneCount + 1} of ${status.totalCount} to go live`}
        </span>
        <span className="block text-sm font-semibold truncate" style={{ color: "#0F1D2A" }}>
          {he ? meta.he : meta.en}
        </span>
      </span>
      <span className="shrink-0 text-lg leading-none" style={{ color: "#1B7FA0" }} aria-hidden>
        {he ? "←" : "→"}
      </span>
    </Link>
  );
}
