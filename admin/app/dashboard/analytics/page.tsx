"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { useCountUp } from "../../lib/useCountUp";
import { formatTimeInTz, dayKeyInTz } from "../../lib/tz";
import { SkeletonCard, SkeletonStatCard } from "../../lib/Skeleton";
import Link from "next/link";

interface Analytics {
  confirmedThisMonth: number;
  cancelledThisMonth: number;
  revenueThisMonth: number;
  newCustomersThisMonth: number;
  allTimeConfirmed: number;
  dailyThisWeek: { date: string; count: number }[];
  prevWeekConfirmed?: number;
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
        background: accent ? "rgba(27,127,160,0.06)" : "#FFFFFF",
        border: `1px solid ${accent ? "rgba(27,127,160,0.2)" : "#E5E5F0"}`,
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-semibold tracking-wide uppercase"
          style={{ color: "#9CA3AF", letterSpacing: "0.08em" }}
        >
          {label}
        </span>
        <span
          className="text-lg"
          style={{
            background: accent ? "rgba(27,127,160,0.12)" : "#E5E5F0",
            borderRadius: 10,
            padding: "6px 10px",
            lineHeight: 1,
          }}
        >
          {icon}
        </span>
      </div>
      <div>
        <p className="text-3xl font-extrabold text-gray-900 tracking-tight leading-none">{value}</p>
        {sub && <p className="text-xs mt-1.5" style={{ color: "#9CA3AF" }}>{sub}</p>}
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

interface Appt {
  id: string;
  startTime: string;
  status: string;
  customer: { name?: string; phone: string };
  service: { name: string };
}

// Time-of-day greeting — makes the landing screen feel like a concierge, not a spreadsheet.
function greetingFor(lang: "he" | "en"): string {
  const h = new Date().getHours();
  if (lang === "he") return h < 12 ? "בוקר טוב" : h < 18 ? "צהריים טובים" : "ערב טוב";
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function AnalyticsPage() {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<Analytics | null>(null);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [todayAppts, setTodayAppts] = useState<Appt[]>([]);
  const [tz, setTz] = useState("Asia/Jerusalem");
  const [businessName, setBusinessName] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<Analytics>("/api/business/analytics"),
      apiFetch<Me & { timezone?: string; name?: string }>("/api/business/me"),
      apiFetch<{ id: string }[]>("/api/business/services"),
      apiFetch<{ id: string }[]>("/api/business/hours"),
      apiFetch<Appt[]>("/api/business/appointments"),
    ]).then(([analytics, me, services, hours, appts]) => {
      setData(analytics);
      setBusinessName(me.name ?? null);
      const businessTz = me.timezone || "Asia/Jerusalem";
      setTz(businessTz);
      setSetup({
        hasServices: services.length > 0,
        hasHours: hours.length > 0,
        whatsappConnected: me.whatsappConnected,
        subscriptionActive: me.subscriptionStatus === "active",
      });
      const todayKey = dayKeyInTz(new Date(), businessTz);
      setTodayAppts(
        appts
          .filter((a) => a.status === "confirmed" && dayKeyInTz(a.startTime, businessTz) === todayKey)
          .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      );
    });
  }, []);

  const allComplete = setup && setup.hasServices && setup.hasHours && setup.whatsappConnected && setup.subscriptionActive;

  const setupSteps = setup ? [
    { done: setup.hasServices,        label: t.stepServices, hint: t.stepServicesHint, href: "/dashboard/services" },
    { done: setup.hasHours,           label: t.stepHours,    hint: t.stepHoursHint,    href: "/dashboard/hours" },
    { done: setup.whatsappConnected,  label: t.stepWhatsapp, hint: t.stepWhatsappHint, href: "/dashboard/whatsapp" },
    { done: setup.subscriptionActive, label: t.stepBilling,  hint: t.stepBillingHint,  href: "/dashboard/billing" },
  ] : [];

  const doneCount = setupSteps.filter(s => s.done).length;

  if (!data) {
    return (
      <div className="animate-fade-in">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">{t.analyticsTitle}</h1>
          <p className="text-sm mt-1" style={{ color: "#9CA3AF" }}>{t.analyticsSubtitle}</p>
        </div>
        <SkeletonCard lines={3} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-8">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonStatCard key={i} />)}
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <SkeletonCard lines={5} />
          <SkeletonCard lines={5} />
        </div>
      </div>
    );
  }

  const maxDaily = Math.max(...data.dailyThisWeek.map((d) => d.count), 1);
  const maxService = Math.max(...data.topServices.map((s) => s.count), 1);
  const dayNames = lang === "he" ? t.daysShort : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  return (
    <div className="animate-fade-in">
      <div className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
          {greetingFor(lang)}{businessName ? `, ${businessName}` : ""} 👋
        </h1>
        <p className="text-sm mt-1" style={{ color: "#9CA3AF" }}>
          {new Date().toLocaleDateString(lang === "he" ? "he-IL" : "en-US", { weekday: "long", day: "numeric", month: "long" })}
          {" · "}
          {todayAppts.length === 0
            ? (lang === "he" ? "אין תורים היום" : "no appointments today")
            : (lang === "he" ? `${todayAppts.length} תורים היום` : `${todayAppts.length} appointments today`)}
        </p>
      </div>

      {/* Today's schedule */}
      <div className="rounded-2xl p-6 mb-8 animate-fade-up" style={{ background: "#FFFFFF", border: "1px solid #E5E5F0" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-900">{lang === "he" ? "היום" : "Today"}</h2>
          <Link href="/dashboard/appointments" className="text-xs font-semibold" style={{ color: "#1B7FA0" }}>
            {lang === "he" ? "כל התורים ←" : "All appointments →"}
          </Link>
        </div>
        {todayAppts.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">🗓️</div>
            <p className="text-sm" style={{ color: "#9CA3AF" }}>
              {lang === "he" ? "אין תורים מתוזמנים להיום" : "No appointments scheduled today"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {todayAppts.map((a, i) => (
              <div
                key={a.id}
                className="flex items-center gap-4 px-4 py-3 rounded-xl animate-fade-up"
                style={{ animationDelay: `${i * 50}ms`, background: "rgba(27,127,160,0.04)", border: "1px solid #EEF1F4" }}
              >
                <div className="text-sm font-bold tabular-nums shrink-0" style={{ color: "#1B7FA0", minWidth: 52 }}>
                  {formatTimeInTz(a.startTime, tz)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{a.customer.name || a.customer.phone}</p>
                  <p className="text-xs truncate" style={{ color: "#9CA3AF" }}>{a.service.name}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Onboarding checklist */}
      {setup && !allComplete && (
        <div
          className="rounded-2xl p-6 mb-8 animate-fade-up stagger-2"
          style={{ background: "#FFFFFF", border: "1px solid rgba(27,127,160,0.15)" }}
        >
          <div className="flex items-start justify-between gap-4 mb-1">
            <div>
              <h2 className="text-base font-bold text-gray-900">{t.setupChecklist}</h2>
              <p className="text-xs mt-0.5" style={{ color: "#9CA3AF" }}>{t.setupSubtitle}</p>
            </div>
            <span
              className="text-xs font-bold px-2.5 py-1 rounded-full shrink-0"
              style={{ background: "rgba(27,127,160,0.12)", color: "#1B7FA0" }}
            >
              {doneCount}/{setupSteps.length}
            </span>
          </div>
          <div className="h-1.5 rounded-full my-4 overflow-hidden" style={{ background: "#E5E5F0" }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${(doneCount / setupSteps.length) * 100}%`, background: "linear-gradient(to right, #145F78, #1B7FA0)" }}
            />
          </div>
          <div className="flex flex-col gap-2">
            {setupSteps.map((step, i) => (
              <Link
                key={step.href}
                href={step.href}
                className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all animate-fade-up"
                style={{
                  animationDelay: `${(i + 3) * 60}ms`,
                  background: step.done ? "transparent" : "rgba(27,127,160,0.04)",
                  border: step.done ? "1px solid transparent" : "1px solid rgba(27,127,160,0.15)",
                }}
              >
                <div
                  className="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
                  style={step.done
                    ? { background: "#1B7FA0", borderColor: "#1B7FA0" }
                    : { borderColor: "rgba(245,158,11,0.4)" }
                  }
                >
                  {step.done ? (
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="#000">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <span className="text-xs font-bold" style={{ color: "#1B7FA0" }}>{i + 1}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={step.done ? { color: "#9CA3AF", textDecoration: "line-through" } : { color: "#1A1A2E" }}>
                    {step.label}
                  </p>
                  {!step.done && step.hint && (
                    <p className="text-xs mt-0.5 truncate" style={{ color: "#9CA3AF" }}>{step.hint}</p>
                  )}
                </div>
                {!step.done && (
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: "rgba(245,158,11,0.5)" }}>
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
          style={{ background: "#FFFFFF", border: "1px solid #E5E5F0" }}
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-gray-900">{t.last7Days}</h2>
            {(() => {
              // Week-over-week trend chip: this week's confirmed bookings vs the 7 days before.
              const thisWeek = data.dailyThisWeek.reduce((s, d) => s + d.count, 0);
              const prev = data.prevWeekConfirmed ?? 0;
              if (prev === 0 && thisWeek === 0) return null;
              const pct = prev === 0 ? 100 : Math.round(((thisWeek - prev) / prev) * 100);
              const up = pct >= 0;
              return (
                <span
                  className="text-xs font-bold px-2 py-1 rounded-full tabular-nums"
                  style={up
                    ? { background: "rgba(22,163,74,0.1)", color: "#16A34A" }
                    : { background: "rgba(220,38,38,0.08)", color: "#DC2626" }}
                  title={lang === "he" ? "לעומת 7 הימים הקודמים" : "vs. the previous 7 days"}
                >
                  {up ? "↑" : "↓"} {Math.abs(pct)}%
                </span>
              );
            })()}
          </div>
          <div className="flex items-end gap-2" style={{ height: 128 }}>
            {data.dailyThisWeek.map(({ date, count }, i) => {
              const heightPct = maxDaily > 0 ? (count / maxDaily) * 100 : 0;
              const d = new Date(date + "T00:00:00");
              const isToday = new Date().toDateString() === d.toDateString();
              return (
                <div key={date} className="flex flex-col items-center flex-1 gap-1">
                  <span className="text-xs font-semibold" style={{ color: count > 0 ? "#1B7FA0" : "transparent" }}>{count > 0 ? count : "·"}</span>
                  <div className="w-full flex items-end" style={{ height: 88 }}>
                    <div
                      className="w-full rounded-t-lg transition-all duration-700"
                      style={{
                        height: `${Math.max(heightPct, count > 0 ? 8 : 2)}%`,
                        background: isToday
                          ? "linear-gradient(to top, #D97706, #F59E0B)"
                          : "rgba(27,127,160,0.2)",
                        animationDelay: `${i * 60 + 300}ms`,
                      }}
                    />
                  </div>
                  <span className="text-xs" style={{ color: isToday ? "#1B7FA0" : "#6B7280", fontWeight: isToday ? 700 : 400 }}>
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
          style={{ background: "#FFFFFF", border: "1px solid #E5E5F0" }}
        >
          <h2 className="text-sm font-semibold text-gray-900 mb-5">{t.topServices}</h2>
          {data.topServices.length === 0 ? (
            <p className="text-sm" style={{ color: "#9CA3AF" }}>{t.noBookings}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {data.topServices.map(({ name, count }, i) => {
                const pct = (count / maxService) * 100;
                return (
                  <div key={name} className="animate-fade-up" style={{ animationDelay: `${i * 60 + 400}ms` }}>
                    <div className="flex justify-between text-xs mb-2">
                      <span className="text-gray-700 truncate max-w-[70%] font-medium">{name}</span>
                      <span className="font-semibold tabular-nums" style={{ color: "#1B7FA0" }}>{count}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#E5E5F0" }}>
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
