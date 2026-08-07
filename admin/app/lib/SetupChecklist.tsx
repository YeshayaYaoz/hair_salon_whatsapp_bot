"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { useLanguage } from "./LanguageContext";

export interface SetupStep {
  key: string;
  done: boolean;
  critical: boolean;
}

export interface SetupStatus {
  steps: SetupStep[];
  complete: boolean;
  doneCount: number;
  totalCount: number;
}

// Exported so the mobile "next step" bar in the dashboard layout links to the same page and
// uses the same wording as this checklist — two places telling an owner different things about
// the same step is worse than either alone.
export const STEP_META: Record<string, { he: string; en: string; href: string; whyHe: string; whyEn: string }> = {
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
  // Only appears for businesses that turned deposits on. Until a provider is connected the bot
  // treats deposits as off without saying so, so the owner thinks bookings are secured when they
  // aren't — this is the only screen that surfaces that.
  payments: {
    he: "חיבור ספק סליקה",
    en: "Connect a payment provider",
    href: "/dashboard/payments",
    whyHe: "ביקשתם מקדמה על כל תור, אבל בלי ספק סליקה הבוט קובע תורים בלי לגבות אותה",
    whyEn: "You asked for a deposit on every booking, but without a provider the bot books without collecting it",
  },
  // Premium only. The voice bot is what the higher price is sold on, but the only way to switch it
  // on is a field on the Bot page that nothing links to — so a salon can pay for it for months and
  // never have a working phone line.
  voice: {
    he: "חיבור בוט טלפוני",
    en: "Connect the voice bot",
    href: "/dashboard/bot",
    whyHe: "המנוי שלכם כולל מענה לשיחות טלפון, אבל בלי מספר הבוט לא יענה לאף שיחה",
    whyEn: "Your plan includes answering phone calls, but without a number the bot answers none",
  },
  billing: {
    he: "הפעלת מנוי",
    en: "Activate subscription",
    href: "/dashboard/billing",
    whyHe: "בסיום תקופת הניסיון הבוט יפסיק לענות ללקוחות עד שיופעל מנוי",
    whyEn: "When the trial ends the bot stops answering customers until a subscription is active",
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
