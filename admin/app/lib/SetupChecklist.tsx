"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { useLanguage } from "./LanguageContext";

interface SetupStep {
  key: string;
  done: boolean;
  critical: boolean;
}

interface SetupStatus {
  steps: SetupStep[];
  complete: boolean;
  doneCount: number;
  totalCount: number;
}

const STEP_META: Record<string, { he: string; en: string; href: string; whyHe: string; whyEn: string }> = {
  category: {
    he: "בחירת סוג העסק",
    en: "Choose your business type",
    href: "/dashboard/onboarding",
    whyHe: "מגדיר עבורך שירותים, מדיניות וטון הבוט מראש",
    whyEn: "Pre-configures your services, policy and bot tone",
  },
  whatsapp: {
    he: "חיבור וואטסאפ",
    en: "Connect WhatsApp",
    href: "/dashboard/whatsapp",
    whyHe: "בלי זה הבוט לא יכול לקבל או לשלוח הודעות בכלל",
    whyEn: "Without this the bot can't receive or send any messages",
  },
  notificationPhone: {
    he: "מספר להתראות",
    en: "Notification phone",
    href: "/dashboard/settings",
    whyHe: "בלי זה לא תקבל התראה על תורים חדשים או בקשות מלקוחות",
    whyEn: "Without this you won't be alerted about new bookings or customer requests",
  },
  services: {
    he: "הוספת שירותים",
    en: "Add services",
    href: "/dashboard/services",
    whyHe: "הבוט מציע ללקוחות רק שירותים שהוגדרו כאן",
    whyEn: "The bot can only offer services defined here",
  },
  hours: {
    he: "הגדרת שעות פעילות",
    en: "Set business hours",
    href: "/dashboard/hours",
    whyHe: "הבוט קובע תורים רק בתוך שעות הפעילות",
    whyEn: "The bot only books inside your opening hours",
  },
};

/**
 * First-run setup progress. Hides itself once everything is done, so it doesn't nag established
 * businesses — but stays until then, since a half-configured business fails in confusing ways
 * (most notably a missing notification phone, which silently swallows every owner alert).
 */
export function SetupChecklist() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [status, setStatus] = useState<SetupStatus | null>(null);

  useEffect(() => {
    apiFetch<SetupStatus>("/api/business/me/setup-status")
      .then(setStatus)
      .catch(() => {});
  }, []);

  if (!status || status.complete) return null;

  const pct = Math.round((status.doneCount / status.totalCount) * 100);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-gray-900">
          {he ? "השלמת ההגדרות" : "Finish setting up"}
        </h2>
        <span className="text-xs text-gray-600 font-medium tabular-nums">
          {status.doneCount}/{status.totalCount}
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-4">
        <div className="h-full bg-[#1B7FA0] rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>

      <ul className="flex flex-col gap-2">
        {status.steps.map((step) => {
          const meta = STEP_META[step.key];
          if (!meta) return null;
          return (
            <li key={step.key} className="flex items-start gap-3">
              <span
                className={`mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-xs ${
                  step.done ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                }`}
                aria-hidden
              >
                {step.done ? "✓" : "○"}
              </span>
              <div className="min-w-0">
                <a
                  href={meta.href}
                  className={`text-sm font-medium ${
                    step.done ? "text-gray-600 line-through" : "text-[#1B7FA0] hover:underline"
                  }`}
                >
                  {he ? meta.he : meta.en}
                </a>
                {!step.done && (
                  <p className="text-xs text-gray-600 mt-0.5">
                    {he ? meta.whyHe : meta.whyEn}
                    {step.critical && (
                      <span className="ms-1.5 text-amber-700 font-medium">
                        {he ? "· חובה" : "· required"}
                      </span>
                    )}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
