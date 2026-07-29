"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
 */
export function MobileSetupBar() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [status, setStatus] = useState<SetupStatus | null>(null);

  useEffect(() => {
    apiFetch<SetupStatus>("/api/business/me/setup-status")
      .then(setStatus)
      .catch(() => {});
  }, []);

  if (!status || status.complete) return null;

  // Critical steps first: an owner who does "add services" before "connect WhatsApp" has a bot
  // that still can't send a single message.
  const next = status.steps.find((s) => !s.done && s.critical) ?? status.steps.find((s) => !s.done);
  const meta = next ? STEP_META[next.key] : undefined;
  if (!next || !meta) return null;

  return (
    <Link
      href={meta.href}
      className="md:hidden fixed bottom-16 start-0 end-0 z-30 flex items-center gap-3 px-4 py-2.5 border-t"
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
