"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { useCountUp } from "../../lib/useCountUp";
import { formatTimeInTz, dayKeyInTz } from "../../lib/tz";
import { SkeletonCard, SkeletonStatCard } from "../../lib/Skeleton";
import { SetupChecklist } from "../../lib/SetupChecklist";
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

// Heroicons outline paths, the same family the sidebar uses. These replace emoji: 📅 👤 🏆 sat
// next to a typographic ₪, so half the row was full-colour glyphs at the OS's mercy and half was
// text — and the calendar emoji renders with a baked-in "17" on most platforms, which reads as a
// stray date on a card about this month's totals.
const STAT_ICONS = {
  calendar: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  shekel: "M6 4h7a4 4 0 014 4v12M18 20h-7a4 4 0 01-4-4V4",
  user: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  trophy: "M8 21h8m-4-4v4M6 4h12v4a6 6 0 11-12 0V4zM6 6H4a2 2 0 002 4M18 6h2a2 2 0 01-2 4",
} as const;

function StatCard({
  label, value, sub, icon, delay = 0, accent = false,
}: {
  label: string; value: string; sub?: string; icon: keyof typeof STAT_ICONS; delay?: number; accent?: boolean;
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
          style={{ color: "#4B5563", letterSpacing: "0.08em" }}
        >
          {label}
        </span>
        <span
          aria-hidden="true"
          className="inline-flex items-center justify-center shrink-0"
          style={{
            background: accent ? "rgba(27,127,160,0.12)" : "#E5E5F0",
            borderRadius: 10,
            width: 30,
            height: 30,
          }}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke={accent ? "#145F78" : "#4B5563"}
            strokeWidth={1.8}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d={STAT_ICONS[icon]} />
          </svg>
        </span>
      </div>
      <div>
        <p className="text-3xl font-extrabold text-gray-900 tracking-tight leading-none">{value}</p>
        {sub && <p className="text-xs mt-1.5" style={{ color: "#4B5563" }}>{sub}</p>}
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
  const [todayAppts, setTodayAppts] = useState<Appt[]>([]);
  const [tz, setTz] = useState("Asia/Jerusalem");
  const [businessName, setBusinessName] = useState<string | null>(null);
  // Without this the page renders its skeleton forever on any load failure — an expired session,
  // a network blip, a 500 — with nothing telling the owner why the dashboard never appears.
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<Analytics>("/api/business/analytics"),
      apiFetch<Me & { timezone?: string; name?: string }>("/api/business/me"),
      apiFetch<Appt[]>("/api/business/appointments"),
      // /services and /hours used to be fetched here purely to drive the inline setup checklist
      // that has since been removed; SetupChecklist gets that state from /me/setup-status itself.
    ]).then(([analytics, me, appts]) => {
      setData(analytics);
      setBusinessName(me.name ?? null);
      const businessTz = me.timezone || "Asia/Jerusalem";
      setTz(businessTz);
      const todayKey = dayKeyInTz(new Date(), businessTz);
      setTodayAppts(
        appts
          .filter((a) => a.status === "confirmed" && dayKeyInTz(a.startTime, businessTz) === todayKey)
          .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      );
    }).catch((err) => setLoadError(err instanceof Error ? err.message : "שגיאה בטעינה"));
  }, []);

  if (loadError) {
    return (
      <div className="animate-fade-in">
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center max-w-md mx-auto mt-8">
          <div className="text-3xl mb-3" aria-hidden>⚠️</div>
          <h1 className="text-base font-bold text-gray-900 mb-1">
            {lang === "he" ? "לא הצלחנו לטעון את הנתונים" : "Couldn't load your data"}
          </h1>
          <p className="text-sm text-gray-600 mb-5">{loadError}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-[#1B7FA0] hover:bg-[#2A9BBF] text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
          >
            {lang === "he" ? "נסה שוב" : "Try again"}
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="animate-fade-in">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">{t.analyticsTitle}</h1>
          <p className="text-sm mt-1" style={{ color: "#4B5563" }}>{t.analyticsSubtitle}</p>
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

  // "Today" per the SALON's clock, not the viewer's device. A device in a western timezone is
  // still on yesterday while the salon is on today, which highlighted the wrong bar. dayKeyInTz
  // is already how this page picks today's appointments (see the loader above).
  const todayKey = dayKeyInTz(new Date(), tz);
  const maxDaily = Math.max(...data.dailyThisWeek.map((d) => d.count), 1);
  const maxService = Math.max(...data.topServices.map((s) => s.count), 1);
  const dayNames = lang === "he" ? t.daysShort : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  return (
    <div className="animate-fade-in">
      <div className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
          {greetingFor(lang)}{businessName ? `, ${businessName}` : ""} 👋
        </h1>
        <p className="text-sm mt-1" style={{ color: "#4B5563" }}>
          {new Date().toLocaleDateString(lang === "he" ? "he-IL" : "en-US", { timeZone: tz, weekday: "long", day: "numeric", month: "long" })}
          {" · "}
          {todayAppts.length === 0
            ? (lang === "he" ? "אין תורים היום" : "no appointments today")
            : (lang === "he" ? `${todayAppts.length} תורים היום` : `${todayAppts.length} appointments today`)}
        </p>
      </div>

      <SetupChecklist />

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
            <p className="text-sm" style={{ color: "#4B5563" }}>
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
                <div className="text-sm font-bold tabular-nums shrink-0" style={{ color: "#197492", minWidth: 52 }}>
                  {formatTimeInTz(a.startTime, tz)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{a.customer.name || a.customer.phone}</p>
                  <p className="text-xs truncate" style={{ color: "#4B5563" }}>{a.service.name}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>


      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          delay={60}
          icon="calendar"
          label={t.thisMonth}
          value={String(data.confirmedThisMonth)}
          sub={`${data.cancelledThisMonth} ${t.subCancelled}`}
        />
        <StatCard
          delay={120}
          icon="shekel"
          label={t.revenue}
          value={`₪${(data.revenueThisMonth / 100).toLocaleString()}`}
          sub={t.subRevenue}
          accent
        />
        <StatCard
          delay={180}
          icon="user"
          label={t.newCustomers}
          value={String(data.newCustomersThisMonth)}
          sub={t.subNewCustomers}
        />
        <StatCard
          delay={240}
          icon="trophy"
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
                    ? { background: "rgba(22,163,74,0.1)", color: "#136B31" }
                    : { background: "rgba(220,38,38,0.08)", color: "#B91C1C" }}
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
              // Noon-anchored so the weekday label can't slip a day on a DST boundary; `date` is
              // already a plain calendar key from the API, so no timeZone belongs on the parse.
              const d = new Date(date + "T12:00:00");
              const isToday = date === todayKey;
              return (
                <div key={date} className="flex flex-col items-center flex-1 gap-1">
                  <span className="text-xs font-semibold" style={{ color: count > 0 ? "#1B7FA0" : "transparent" }}>{count > 0 ? count : "·"}</span>
                  <div className="w-full flex items-end" style={{ height: 88 }}>
                    <div
                      className="w-full rounded-t-lg transition-all duration-700"
                      style={{
                        height: `${Math.max(heightPct, count > 0 ? 8 : 2)}%`,
                        // Today is the brand teal at full strength; other days are the same hue
                        // at 20%. It used to be an amber gradient — but the top-services chart
                        // beside it painted *every* bar that same amber, so the one colour meant
                        // "today" in one chart and nothing at all in the other.
                        background: isToday ? "#1B7FA0" : "rgba(27,127,160,0.2)",
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
            <p className="text-sm" style={{ color: "#4B5563" }}>{t.noBookings}</p>
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
                        style={{ width: `${pct}%`, background: "#1B7FA0" }}
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
