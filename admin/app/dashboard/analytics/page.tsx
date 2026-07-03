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

function StatCard({
  label, value, sub, icon, delay = 0, accent = false,
}: {
  label: string; value: string; sub?: string; icon: string; delay?: number; accent?: boolean;
}) {
  return (
    <div
      className="rounded-2xl p-6 animate-fade-up flex flex-col gap-3"
      style={{
        animationDelay: `${delay}ms`,
        background: accent ? "rgba(245,158,11,0.08)" : "#0F1420",
        border: `1px solid ${accent ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.06)"}`,
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-semibold tracking-wide uppercase"
          style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em" }}
        >
          {label}
        </span>
        <span
          className="text-lg"
          style={{
            background: accent ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.06)",
            borderRadius: 10,
            padding: "6px 10px",
            lineHeight: 1,
          }}
        >
          {icon}
        </span>
      </div>
      <div>
        <p className="text-3xl font-extrabold text-white tracking-tight leading-none">{value}</p>
        {sub && <p className="text-xs mt-1.5" style={{ color: "rgba(255,255,255,0.35)" }}>{sub}</p>}
      </div>
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

  const doneCount = setupSteps.filter(s => s.done).length;

  if (!data) {
    return (
      <div className="animate-fade-in">
        <h1 className="text-2xl font-bold text-white mb-6">{t.analyticsTitle}</h1>
        <p className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>{t.loading}</p>
      </div>
    );
  }

  const maxDaily = Math.max(...data.dailyThisWeek.map((d) => d.count), 1);
  const maxService = Math.max(...data.topServices.map((s) => s.count), 1);
  const dayNames = lang === "he" ? t.daysShort : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  return (
    <div className="animate-fade-in">
      <div className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-extrabold text-white tracking-tight">{t.analyticsTitle}</h1>
        <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>{t.analyticsSubtitle}</p>
      </div>

      {/* Onboarding checklist */}
      {setup && !allComplete && (
        <div
          className="rounded-2xl p-5 mb-8 animate-fade-up stagger-2"
          style={{ background: "#0F1420", border: "1px solid rgba(245,158,11,0.2)" }}
        >
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-white">{t.setupChecklist}</h2>
            <span className="text-xs font-medium" style={{ color: "#F59E0B" }}>{doneCount}/{setupSteps.length}</span>
          </div>
          {/* Progress bar */}
          <div className="h-1 rounded-full mb-4 overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(doneCount / setupSteps.length) * 100}%`, background: "#F59E0B" }}
            />
          </div>
          <div className="flex flex-col gap-2">
            {setupSteps.map((step, i) => (
              <Link
                key={step.href}
                href={step.href}
                className="flex items-center gap-3 group animate-fade-up"
                style={{ animationDelay: `${(i + 3) * 60}ms` }}
              >
                <div
                  className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
                  style={step.done
                    ? { background: "#F59E0B", borderColor: "#F59E0B" }
                    : { borderColor: "rgba(255,255,255,0.2)" }
                  }
                >
                  {step.done && (
                    <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span
                  className="text-sm transition-all"
                  style={step.done
                    ? { color: "rgba(255,255,255,0.3)", textDecoration: "line-through" }
                    : { color: "rgba(255,255,255,0.85)" }
                  }
                >
                  {step.label}
                </span>
                {!step.done && (
                  <svg className="w-3.5 h-3.5 ms-auto transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: "rgba(255,255,255,0.2)" }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          delay={60}
          icon="📅"
          label={t.thisMonth}
          value={String(data.confirmedThisMonth)}
          sub={`${data.cancelledThisMonth} ${t.subCancelled}`}
        />
        <StatCard
          delay={120}
          icon="₪"
          label={t.revenue}
          value={`₪${(data.revenueThisMonth / 100).toLocaleString()}`}
          sub={t.subRevenue}
          accent
        />
        <StatCard
          delay={180}
          icon="👤"
          label={t.newCustomers}
          value={String(data.newCustomersThisMonth)}
          sub={t.subNewCustomers}
        />
        <StatCard
          delay={240}
          icon="🏆"
          label={t.allTime}
          value={String(data.allTimeConfirmed)}
          sub={t.subAllTime}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Daily bar chart */}
        <div
          className="rounded-2xl p-6 animate-fade-up stagger-5"
          style={{ background: "#0F1420", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <h2 className="text-sm font-semibold text-white mb-5">{t.last7Days}</h2>
          <div className="flex items-end gap-2" style={{ height: 128 }}>
            {data.dailyThisWeek.map(({ date, count }, i) => {
              const heightPct = maxDaily > 0 ? (count / maxDaily) * 100 : 0;
              const d = new Date(date + "T00:00:00");
              const isToday = new Date().toDateString() === d.toDateString();
              return (
                <div key={date} className="flex flex-col items-center flex-1 gap-1">
                  <span className="text-xs font-semibold" style={{ color: count > 0 ? "#F59E0B" : "transparent" }}>{count > 0 ? count : "·"}</span>
                  <div className="w-full flex items-end" style={{ height: 88 }}>
                    <div
                      className="w-full rounded-t-lg transition-all duration-700"
                      style={{
                        height: `${Math.max(heightPct, count > 0 ? 8 : 2)}%`,
                        background: isToday
                          ? "linear-gradient(to top, #D97706, #F59E0B)"
                          : "rgba(245,158,11,0.3)",
                        animationDelay: `${i * 60 + 300}ms`,
                      }}
                    />
                  </div>
                  <span className="text-xs" style={{ color: isToday ? "#F59E0B" : "rgba(255,255,255,0.3)", fontWeight: isToday ? 700 : 400 }}>
                    {dayNames[d.getDay()]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top services */}
        <div
          className="rounded-2xl p-6 animate-fade-up stagger-6"
          style={{ background: "#0F1420", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <h2 className="text-sm font-semibold text-white mb-5">{t.topServices}</h2>
          {data.topServices.length === 0 ? (
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>{t.noBookings}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {data.topServices.map(({ name, count }, i) => {
                const pct = (count / maxService) * 100;
                return (
                  <div key={name} className="animate-fade-up" style={{ animationDelay: `${i * 60 + 400}ms` }}>
                    <div className="flex justify-between text-xs mb-2">
                      <span className="text-zinc-200 truncate max-w-[70%] font-medium">{name}</span>
                      <span className="font-semibold tabular-nums" style={{ color: "#F59E0B" }}>{count}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: "linear-gradient(to right, #D97706, #F59E0B)" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
