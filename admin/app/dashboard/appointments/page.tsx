"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";

interface Appointment {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  customer: { name?: string; phone: string };
  service: { name: string };
  staff?: { name: string } | null;
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-green-950/50 text-green-400 border-green-800",
  cancelled: "bg-red-950/50 text-red-400 border-red-800",
  pending: "bg-yellow-950/50 text-yellow-400 border-yellow-800",
};

type Filter = "upcoming" | "past" | "cancelled" | "all";

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function load() {
    setAppointments(await apiFetch<Appointment[]>("/api/business/appointments"));
  }

  useEffect(() => {
    load();
  }, []);

  async function cancel(id: string) {
    setCancellingId(id);
    try {
      await apiFetch(`/api/business/appointments/${id}/cancel`, { method: "PATCH" });
      await load();
    } finally {
      setCancellingId(null);
    }
  }

  const filtered = useMemo(() => {
    const now = new Date();
    return appointments
      .filter((a) => {
        if (filter === "cancelled") return a.status === "cancelled";
        if (filter === "all") return true;
        if (a.status === "cancelled") return false;
        const isFuture = new Date(a.startTime) >= now;
        return filter === "upcoming" ? isFuture : !isFuture;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [appointments, filter]);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "upcoming", label: "Upcoming" },
    { key: "past", label: "Past" },
    { key: "cancelled", label: "Cancelled" },
    { key: "all", label: "All" },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Appointments</h1>
          <p className="text-zinc-400 text-sm mt-1">Bookings made through WhatsApp</p>
        </div>
        <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-xs font-medium px-3 py-1.5 rounded-md transition ${
                filter === f.key ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-zinc-500 text-sm">No {filter} appointments.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-400 font-medium">When</th>
                <th className="text-left px-4 py-3 text-zinc-400 font-medium">Customer</th>
                <th className="text-left px-4 py-3 text-zinc-400 font-medium">Service</th>
                <th className="text-left px-4 py-3 text-zinc-400 font-medium">Staff</th>
                <th className="text-left px-4 py-3 text-zinc-400 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((a, i) => (
                <tr key={a.id} className={i !== filtered.length - 1 ? "border-b border-zinc-800/50" : ""}>
                  <td className="px-4 py-3 text-zinc-200 whitespace-nowrap">
                    {new Date(a.startTime).toLocaleString(undefined, {
                      weekday: "short", month: "short", day: "numeric",
                      hour: "numeric", minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-zinc-200 font-medium">{a.customer.name ?? "—"}</div>
                    <div className="text-zinc-500 text-xs">{a.customer.phone}</div>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{a.service.name}</td>
                  <td className="px-4 py-3 text-zinc-400">{a.staff?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLES[a.status] ?? "bg-zinc-800 text-zinc-400 border-zinc-700"}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {a.status === "confirmed" && new Date(a.startTime) >= new Date() && (
                      <button
                        onClick={() => cancel(a.id)}
                        disabled={cancellingId === a.id}
                        className="text-xs text-zinc-500 hover:text-red-400 disabled:opacity-50 transition px-2 py-1 rounded hover:bg-red-950/30"
                      >
                        {cancellingId === a.id ? "Cancelling..." : "Cancel"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
