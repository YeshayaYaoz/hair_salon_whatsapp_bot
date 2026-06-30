"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";

interface Analytics {
  confirmedThisMonth: number;
  cancelledThisMonth: number;
  revenueThisMonth: number;
  newCustomersThisMonth: number;
  allTimeConfirmed: number;
  dailyThisWeek: { date: string; count: number }[];
  topServices: { name: string; count: number }[];
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);

  useEffect(() => {
    apiFetch<Analytics>("/api/business/analytics").then(setData);
  }, []);

  if (!data) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white mb-6">Analytics</h1>
        <p className="text-zinc-500 text-sm">Loading...</p>
      </div>
    );
  }

  const maxDaily = Math.max(...data.dailyThisWeek.map((d) => d.count), 1);
  const maxService = Math.max(...data.topServices.map((s) => s.count), 1);

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Analytics</h1>
        <p className="text-zinc-400 text-sm mt-1">Overview of your salon's performance</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Appointments this month"
          value={String(data.confirmedThisMonth)}
          sub={`${data.cancelledThisMonth} cancelled`}
        />
        <StatCard
          label="Revenue this month"
          value={`₪${(data.revenueThisMonth / 100).toLocaleString()}`}
          sub="from confirmed bookings"
        />
        <StatCard
          label="New customers"
          value={String(data.newCustomersThisMonth)}
          sub="booked this month"
        />
        <StatCard
          label="All-time bookings"
          value={String(data.allTimeConfirmed)}
          sub="confirmed total"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Daily bar chart */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Appointments — last 7 days</h2>
          <div className="flex items-end gap-2 h-32">
            {data.dailyThisWeek.map(({ date, count }) => {
              const heightPct = maxDaily > 0 ? (count / maxDaily) * 100 : 0;
              const d = new Date(date + "T00:00:00");
              const label = days[d.getDay()];
              return (
                <div key={date} className="flex flex-col items-center flex-1 gap-1">
                  <span className="text-xs text-zinc-400">{count > 0 ? count : ""}</span>
                  <div className="w-full flex items-end" style={{ height: "96px" }}>
                    <div
                      className="w-full rounded-t-md bg-violet-600 transition-all"
                      style={{ height: `${Math.max(heightPct, count > 0 ? 8 : 3)}%` }}
                    />
                  </div>
                  <span className="text-xs text-zinc-500">{label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top services */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Top services</h2>
          {data.topServices.length === 0 ? (
            <p className="text-zinc-500 text-sm">No bookings yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {data.topServices.map(({ name, count }) => {
                const pct = (count / maxService) * 100;
                return (
                  <div key={name}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-zinc-300 truncate max-w-[70%]">{name}</span>
                      <span className="text-zinc-500">{count} bookings</span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-500 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
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
