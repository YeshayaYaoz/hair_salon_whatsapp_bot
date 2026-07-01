"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { useCountUp } from "../../lib/useCountUp";
import Link from "next/link";

interface Analytics {
  confirmedThisMonth: number;
  cancelledThisMonth: number;
  revenueThisMonth: number;
  newCustomersThisMonth: number;
  allTimeConfirmed: number;
  dailyThisWeek: { date: string; count: number }[];
  topServices: { name: string; count: number }[];
}

interface Me {
  subscriptionStatus: string;
  whatsappConnected: boolean;
}

interface SetupState {
  hasServices: boolean;
  hasHours: boolean;
  whatsappConnected: boolean;
  subscriptionActive: boolean;
}

function StatCard({ label, value, sub, delay = 0 }: { label: string; value: string; sub?: string; delay?: number }) {
  return (
    <div
      className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
    </div>
  );
}

function AnimatedRevenue({ cents }: { cents: number }) {
  const val = useCountUp(Math.round(cents / 100));
  return <>{`₪${val.toLocaleString()}`}</>;
}

function AnimatedCount({ n }: { n: number }) {
  const val = useCountUp(n);
  return <>{val}</>;
}

export default function AnalyticsPage() {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<Analytics | null>(null);
  const [setup, setSetup] = useState<SetupState | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<Analytics>("/api/business/analytics"),
      apiFetch<Me>("/api/business/me"),
      apiFetch<{ id: string }[]>("/api/business/services"),
      apiFetch<{ id: string }[]>("/api/business/hours"),
    ]).then(([analytics, me, services, hours]) => {
      setData(analytics);
      setSetup({
        hasServices: services.length > 0,
        hasHours: hours.length > 0,
        whatsappConnected: me.whatsappConnected,
        subscriptionActive: me.subscriptionStatus === "active",
      });
    });
  }, []);

  const allComplete = setup && setup.hasServices && setup.hasHours && setup.whatsappConnected && setup.subscriptionActive;

  const setupSteps = setup ? [
    { done: setup.hasServices,        label: t.stepServices, href: "/dashboard/services" },
    { done: setup.hasHours,           label: t.stepHours,    href: "/dashboard/hours" },
    { done: setup.whatsappConnected,  label: t.stepWhatsapp, href: "/dashboard/whatsapp" },
    { done: setup.subscriptionActive, label: t.stepBilling,  href: "/dashboard/billing" },
  ] : [];

  if (!data) {
    return (
      <div className="animate-fade-in">
        <h1 className="text-2xl font-bold text-white mb-6">{t.analyticsTitle}</h1>
        <p className="text-zinc-500 text-sm">{t.loading}</p>
      </div>
    );
  }

  const maxDaily = Math.max(...data.dailyThisWeek.map((d) => d.count), 1);
  const maxService = Math.max(...data.topServices.map((s) => s.count), 1);
  const dayNames = lang === "he" ? t.daysShort : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  return (
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-white">{t.analyticsTitle}</h1>
        <p className="text-zinc-400 text-sm mt-1">{t.analyticsSubtitle}</p>
      </div>

      {/* Onboarding checklist */}
      {setup && !allComplete && (
        <div className="bg-zinc-900 border border-violet-800/50 rounded-xl p-5 mb-6 animate-fade-up stagger-2">
          <h2 className="text-sm font-semibold text-white mb-0.5">{t.setupChecklist}</h2>
          <p className="text-xs text-zinc-500 mb-4">{t.setupSubtitle}</p>
          <div className="flex flex-col gap-2">
            {setupSteps.map((step, i) => (
              <Link
                key={step.href}
                href={step.href}
                className="flex items-center gap-3 group animate-fade-up"
                style={{ animationDelay: `${(i + 3) * 60}ms` }}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition ${step.done ? "bg-green-500 border-green-500" : "border-zinc-600 group-hover:border-violet-500"}`}>
                  {step.done && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className={`text-sm transition ${step.done ? "text-zinc-500 line-through" : "text-zinc-200 group-hover:text-violet-400"}`}>{step.label}</span>
                {!step.done && (
                  <svg className="w-3.5 h-3.5 text-zinc-600 group-hover:text-violet-400 ms-auto transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Stat cards with count-up */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard delay={60}  label={t.thisMonth}    value={String(data.confirmedThisMonth)}    sub={`${data.cancelledThisMonth} ${t.subCancelled}`} />
        <StatCard delay={120} label={t.revenue}       value={`₪${(data.revenueThisMonth / 100).toLocaleString()}`} sub={t.subRevenue} />
        <StatCard delay={180} label={t.newCustomers}  value={String(data.newCustomersThisMonth)} sub={t.subNewCustomers} />
        <StatCard delay={240} label={t.allTime}       value={String(data.allTimeConfirmed)}      sub={t.subAllTime} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Daily bar chart */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 animate-fade-up stagger-5">
          <h2 className="text-sm font-semibold text-white mb-4">{t.last7Days}</h2>
          <div className="flex items-end gap-2 h-32">
            {data.dailyThisWeek.map(({ date, count }, i) => {
              const heightPct = maxDaily > 0 ? (count / maxDaily) * 100 : 0;
              const d = new Date(date + "T00:00:00");
              return (
                <div key={date} className="flex flex-col items-center flex-1 gap-1">
                  <span className="text-xs text-zinc-400">{count > 0 ? count : ""}</span>
                  <div className="w-full flex items-end" style={{ height: "96px" }}>
                    <div
                      className="w-full rounded-t-md bg-violet-600 transition-all duration-700"
                      style={{
                        height: `${Math.max(heightPct, count > 0 ? 8 : 3)}%`,
                        animationDelay: `${i * 60 + 300}ms`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-zinc-500">{dayNames[d.getDay()]}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top services */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 animate-fade-up stagger-6">
          <h2 className="text-sm font-semibold text-white mb-4">{t.topServices}</h2>
          {data.topServices.length === 0 ? (
            <p className="text-zinc-500 text-sm">{t.noBookings}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {data.topServices.map(({ name, count }, i) => (
                <div key={name} className="animate-fade-up" style={{ animationDelay: `${i * 60 + 400}ms` }}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-zinc-300 truncate max-w-[70%]">{name}</span>
                    <span className="text-zinc-500">{count}</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-500 rounded-full transition-all duration-700"
                      style={{ width: `${(count / maxService) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
