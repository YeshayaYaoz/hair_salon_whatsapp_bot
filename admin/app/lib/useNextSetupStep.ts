"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { apiFetch } from "./api";
import { STEP_META, type SetupStatus } from "./SetupChecklist";

/**
 * The one setup step a half-configured business should be nudged towards next, or null.
 *
 * This used to be a component — a fixed amber bar stacked on top of the mobile tab bar. The need
 * it served is real and hasn't changed: the mobile tab bar only has room for a handful of
 * destinations, so setup pages (WhatsApp, hours, notification phone, billing) all live behind the
 * "More" sheet, and a new owner has to already know what they're looking for and where it hides.
 *
 * What changed is where it belongs. As a separate bar it was a second piece of fixed chrome — its
 * own 55px, stacked on the 64px tab bar at the same z-index, so which one drew on top came down to
 * DOM order. As a hook, the same information renders as a strip inside the nav dock itself: one
 * piece of chrome, roughly a third of the height, and no stacking to get wrong.
 *
 * Returns null on /dashboard/analytics, which renders the full <SetupChecklist /> inline. Nagging
 * about the same step twice on one screen, in two different shapes, is worse than not nagging.
 */
export type NextSetupStep = {
  href: string;
  label: string;
  critical: boolean;
  stepNumber: number;
  totalCount: number;
};

export function useNextSetupStep(lang: "he" | "en"): NextSetupStep | null {
  const pathname = usePathname();
  const [status, setStatus] = useState<SetupStatus | null>(null);

  useEffect(() => {
    apiFetch<SetupStatus>("/api/business/me/setup-status")
      .then(setStatus)
      .catch(() => {});
  }, []);

  if (pathname === "/dashboard/analytics") return null;
  if (!status || status.complete) return null;

  // Critical steps first: an owner who does "add services" before "connect WhatsApp" has a bot
  // that still can't send a single message.
  const next = status.steps.find((s) => !s.done && s.critical) ?? status.steps.find((s) => !s.done);
  const meta = next ? STEP_META[next.key] : undefined;
  if (!next || !meta) return null;

  return {
    href: meta.href,
    label: lang === "he" ? meta.he : meta.en,
    critical: Boolean(next.critical),
    stepNumber: status.doneCount + 1,
    totalCount: status.totalCount,
  };
}
