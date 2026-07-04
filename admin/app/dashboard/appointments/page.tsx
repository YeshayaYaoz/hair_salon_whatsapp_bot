"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";

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
  confirmed: "bg-green-50 text-green-700 border-green-200",
  cancelled: "bg-red-950/50 text-red-600 border-red-200",
  pending: "bg-yellow-950/50 text-yellow-400 border-yellow-800",
};

type Filter = "upcoming" | "past" | "cancelled" | "all";

function googleCalendarUrl(a: Appointment) {
  const fmt = (d: string) => new Date(d).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${a.service.name} — ${a.customer.name ?? a.customer.phone}`,
    dates: `${fmt(a.startTime)}/${fmt(a.endTime)}`,
    details: `Customer: ${a.customer.name ?? ""} (${a.customer.phone})${a.staff ? `\nStaff: ${a.staff.name}` : ""}`,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function exportCsv(appointments: Appointment[]) {
  const rows = [
    ["Date", "Time", "Customer Name", "Phone", "Service", "Staff", "Status"],
    ...appointments.map((a) => [
      new Date(a.startTime).toLocaleDateString(),
      new Date(a.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      a.customer.name ?? "",
      a.customer.phone,
      a.service.name,
      a.staff?.name ?? "",
      a.status,
    ]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "appointments.csv"; a.click();
  URL.revokeObjectURL(url);
}

export default function AppointmentsPage() {
  const { t } = useLanguage();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [search, setSearch] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function load() {
    setAppointments(await apiFetch<Appointment[]>("/api/business/appointments"));
  }

  useEffect(() => { load(); }, []);

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
        if (search) {
          const q = search.toLowerCase();
          if (!a.customer.phone.includes(q) && !(a.customer.name ?? "").toLowerCase().includes(q)) return false;
        }
        if (filter === "cancelled") return a.status === "cancelled";
        if (filter === "all") return true;
        if (a.status === "cancelled") return false;
        const isFuture = new Date(a.startTime) >= now;
        return filter === "upcoming" ? isFuture : !isFuture;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [appointments, filter, search]);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "upcoming", label: t.upcoming },
    { key: "past",     label: t.past },
    { key: "cancelled",label: t.cancelled },
    { key: "all",      label: t.all },
  ];

  return (
    <div className="animate-fade-in">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3 animate-fade-up">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.appointmentsTitle}</h1>
          <p className="text-gray-500 text-sm mt-1">{t.appointmentsSubtitle}</p>
        </div>
        <button
          onClick={() => exportCsv(filtered)}
          className="flex items-center gap-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium px-3 py-2 rounded-lg transition"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {t.exportCsv}
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap animate-fade-up stagger-2">
        <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-xs font-medium px-3 py-1.5 rounded-md transition ${filter === f.key ? "bg-violet-600 text-gray-900" : "text-gray-500 hover:text-gray-800"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          placeholder={t.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-52 text-sm"
        />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden animate-fade-up stagger-3">
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400 text-sm">{t.noAppointments}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-start px-4 py-3 text-gray-500 font-medium">{t.when}</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">{t.customer}</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">{t.service}</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium hidden md:table-cell">{t.staff}</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">{t.status}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((a, i) => (
                <tr key={a.id} className={i !== filtered.length - 1 ? "border-b border-gray-200/50" : ""}>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap text-xs">
                    {new Date(a.startTime).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-700 font-medium text-sm">{a.customer.name ?? "—"}</div>
                    <div className="text-gray-400 text-xs">{a.customer.phone}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-sm">{a.service.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-sm hidden md:table-cell">{a.staff?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLES[a.status] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-end">
                    <div className="flex items-center justify-end gap-1">
                      {a.status === "confirmed" && (
                        <a href={googleCalendarUrl(a)} target="_blank" rel="noopener noreferrer" title="Add to Google Calendar"
                          className="text-gray-400 hover:text-violet-600 transition px-1.5 py-1 rounded hover:bg-violet-50">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </a>
                      )}
                      {a.status === "confirmed" && new Date(a.startTime) >= new Date() && (
                        <button onClick={() => cancel(a.id)} disabled={cancellingId === a.id}
                          className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50 transition px-2 py-1 rounded hover:bg-red-950/30">
                          {cancellingId === a.id ? "…" : t.cancel}
                        </button>
                      )}
                    </div>
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
