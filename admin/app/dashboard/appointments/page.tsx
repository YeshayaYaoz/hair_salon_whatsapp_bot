"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { formatTimeInTz, formatDateTimeInTz, partsInTz, dayKeyInTz } from "../../lib/tz";
import { SkeletonBlock, SkeletonRow } from "../../lib/Skeleton";

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
type ViewMode = "list" | "calendar";

function NewAppointmentModal({ tz, onClose, onCreated }: { tz: string; onClose: () => void; onCreated: () => void }) {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [startTime, setStartTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ id: string; name: string }[]>("/api/business/services").then((s) => {
      setServices(s);
      if (s[0]) setServiceId(s[0].id);
    }).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/business/appointments", {
        method: "POST",
        body: JSON.stringify({ serviceId, customerName, customerPhone, startTime }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl flex flex-col gap-4 animate-fade-up"
        dir={he ? "rtl" : "ltr"}
      >
        <h2 className="text-lg font-bold text-gray-900">{he ? "תור חדש (ידני)" : "New appointment (manual)"}</h2>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">{he ? "שירות" : "Service"}</label>
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} required className="w-full">
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">{he ? "שם הלקוח" : "Customer name"}</label>
          <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required className="w-full" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">{he ? "טלפון" : "Phone"}</label>
          <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} required placeholder="972501234567" className="w-full" dir="ltr" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">{he ? "מועד" : "Date & time"}</label>
          <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} required className="w-full" dir="ltr" />
          <p className="text-[11px] text-gray-400 mt-1">{he ? `לפי אזור הזמן ${tz}` : `In timezone ${tz}`}</p>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex items-center gap-2 justify-end">
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800 px-4 py-2">
            {he ? "ביטול" : "Cancel"}
          </button>
          <button type="submit" disabled={saving || !serviceId} className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
            {saving ? "…" : (he ? "קבע תור" : "Book")}
          </button>
        </div>
      </form>
    </div>
  );
}

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

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // Sunday
  return d;
}

function WeekCalendar({
  appointments,
  weekStart,
  onCancel,
  cancellingId,
  tz,
}: {
  appointments: Appointment[];
  weekStart: Date;
  onCancel: (id: string) => void;
  cancellingId: string | null;
  tz: string;
}) {
  const { t } = useLanguage();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const hours = Array.from({ length: 15 }, (_, i) => i + 7); // 7am-9pm

  function apptsByDay(day: Date) {
    const key = localDayKey(day);
    return appointments.filter((a) => dayKeyInTz(a.startTime, tz) === key && a.status === "confirmed");
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Day headers */}
      <div className="grid border-b border-gray-200" style={{ gridTemplateColumns: "3.5rem repeat(7, 1fr)" }}>
        <div className="px-2 py-2 border-e border-gray-100" />
        {days.map((d) => {
          const today = d.toDateString() === new Date().toDateString();
          return (
            <div key={d.toISOString()} className={`px-1 py-2 text-center border-e border-gray-100 last:border-e-0 ${today ? "bg-[#E0F5FB]" : ""}`}>
              <div className="text-xs text-gray-400">{t.daysShort[d.getDay()]}</div>
              <div className={`text-sm font-semibold ${today ? "text-[#1B7FA0]" : "text-gray-700"}`}>{d.getDate()}</div>
            </div>
          );
        })}
      </div>

      {/* Time grid — renders in full; the page itself scrolls rather than nesting another scrollbar */}
      <div>
        {hours.map((h) => (
          <div key={h} className="grid border-b border-gray-100/70 last:border-b-0" style={{ gridTemplateColumns: "3.5rem repeat(7, 1fr)", minHeight: 48 }}>
            <div className="px-2 pt-1 text-xs text-gray-400 border-e border-gray-100 leading-none">{h}:00</div>
            {days.map((d) => {
              const appts = apptsByDay(d).filter((a) => partsInTz(a.startTime, tz).hour === h);
              const today = d.toDateString() === new Date().toDateString();
              return (
                <div key={d.toISOString()} className={`border-e border-gray-100 last:border-e-0 p-0.5 flex flex-col gap-0.5 ${today ? "bg-[#E0F5FB]/40" : ""}`}>
                  {appts.map((a) => (
                    <div
                      key={a.id}
                      className="bg-[#1B7FA0] text-white rounded px-1.5 py-1 text-[10px] leading-tight cursor-default hover:bg-[#2A9BBF] transition group relative"
                      title={`${a.customer.name ?? a.customer.phone} · ${a.service.name}`}
                    >
                      <div className="font-semibold truncate">{formatTimeInTz(a.startTime, tz)}</div>
                      <div className="truncate opacity-80">{a.customer.name ?? a.customer.phone}</div>
                      <div className="truncate opacity-70">{a.service.name}</div>
                      {new Date(a.startTime) >= new Date() && (
                        <button
                          onClick={() => onCancel(a.id)}
                          disabled={cancellingId === a.id}
                          className="absolute top-0.5 end-0.5 opacity-0 group-hover:opacity-100 text-white/70 hover:text-white transition text-xs leading-none"
                          title={t.cancel}
                        >×</button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AppointmentsPage() {
  const { t, lang } = useLanguage();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [search, setSearch] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("calendar");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [tz, setTz] = useState("Asia/Jerusalem");
  const [showNew, setShowNew] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCancelling, setBulkCancelling] = useState(false);

  // Selections are tied to what's currently visible — clear them when the visible set changes filters.
  useEffect(() => { setSelected(new Set()); }, [filter, search]);

  async function load() {
    setAppointments(await apiFetch<Appointment[]>("/api/business/appointments"));
    setLoaded(true);
  }

  useEffect(() => {
    apiFetch<{ timezone?: string }>("/api/business/me")
      .then((me) => { if (me.timezone) setTz(me.timezone); })
      .catch(() => {});
    load();
    // Auto-refresh so new bookings made via WhatsApp appear without a manual reload.
    const interval = setInterval(() => {
      load().catch(() => {});
    }, 30_000);
    // Also refresh when the tab regains focus.
    const onFocus = () => load().catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
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

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(ids: string[]) {
    setSelected((prev) => (prev.size === ids.length ? new Set() : new Set(ids)));
  }

  async function bulkCancel() {
    const count = selected.size;
    if (count === 0) return;
    const confirmMsg = lang === "he" ? `לבטל ${count} תורים נבחרים?` : `Cancel ${count} selected appointments?`;
    if (!confirm(confirmMsg)) return;
    setBulkCancelling(true);
    try {
      await Promise.all(
        Array.from(selected).map((id) => apiFetch(`/api/business/appointments/${id}/cancel`, { method: "PATCH" }))
      );
      setSelected(new Set());
      await load();
    } finally {
      setBulkCancelling(false);
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

  const cancellableIds = useMemo(
    () => filtered.filter((a) => a.status === "confirmed" && new Date(a.startTime) >= new Date()).map((a) => a.id),
    [filtered]
  );

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "upcoming", label: t.upcoming },
    { key: "past",     label: t.past },
    { key: "cancelled",label: t.cancelled },
    { key: "all",      label: t.all },
  ];

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  return (
    <div className="animate-fade-in">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3 animate-fade-up">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.appointmentsTitle}</h1>
          <p className="text-gray-500 text-sm mt-1">{t.appointmentsSubtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
            {(["list", "calendar"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`text-xs font-medium px-3 py-1.5 rounded-md transition ${view === v ? "bg-[#1B7FA0] text-white" : "text-gray-500 hover:text-gray-800"}`}
              >
                {v === "list" ? t.listView : t.calendarView}
              </button>
            ))}
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
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 text-xs bg-[#1B7FA0] hover:bg-[#2A9BBF] text-white font-semibold px-3 py-2 rounded-lg transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            {t.newAppointment}
          </button>
        </div>
      </div>

      {showNew && (
        <NewAppointmentModal
          tz={tz}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }}
        />
      )}

      {view === "calendar" ? (
        <>
          <div className="flex items-center gap-3 mb-4 animate-fade-up stagger-2">
            <button
              onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d); }}
              className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 transition"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm font-medium text-gray-700">
              {weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} — {weekEnd.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </span>
            <button
              onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d); }}
              className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 transition"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <button
              onClick={() => setWeekStart(startOfWeek(new Date()))}
              className="text-xs text-[#1B7FA0] hover:text-[#145F78] font-medium px-2 py-1 rounded-lg hover:bg-[#E0F5FB] transition"
            >
              Today
            </button>
          </div>
          {loaded ? (
            <WeekCalendar
              appointments={appointments}
              weekStart={weekStart}
              onCancel={cancel}
              cancellingId={cancellingId}
              tz={tz}
            />
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="grid" style={{ gridTemplateColumns: "3.5rem repeat(7, 1fr)" }}>
                <div className="px-2 py-2 border-e border-b border-gray-100" />
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="px-1 py-2 border-e border-b border-gray-100 last:border-e-0 flex flex-col items-center gap-1">
                    <SkeletonBlock className="h-2.5 w-6" />
                    <SkeletonBlock className="h-4 w-4" />
                  </div>
                ))}
              </div>
              {Array.from({ length: 6 }).map((_, row) => (
                <div key={row} className="grid border-b border-gray-100/70 last:border-b-0" style={{ gridTemplateColumns: "3.5rem repeat(7, 1fr)", minHeight: 48 }}>
                  <div className="px-2 pt-2 border-e border-gray-100"><SkeletonBlock className="h-2.5 w-6" /></div>
                  {Array.from({ length: 7 }).map((_, col) => <div key={col} className="border-e border-gray-100 last:border-e-0 p-1" />)}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-4 flex-wrap animate-fade-up stagger-2">
            <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition ${filter === f.key ? "bg-[#1B7FA0] text-white" : "text-gray-500 hover:text-gray-800"}`}
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
            {selected.size > 0 && (
              <div className="flex items-center gap-2 ms-auto">
                <span className="text-xs text-gray-500">
                  {lang === "he" ? `${selected.size} נבחרו` : `${selected.size} selected`}
                </span>
                <button
                  onClick={bulkCancel}
                  disabled={bulkCancelling}
                  className="text-xs font-medium text-red-600 hover:text-white hover:bg-red-600 disabled:opacity-50 transition border border-red-200 px-3 py-1.5 rounded-lg"
                >
                  {bulkCancelling ? "…" : (lang === "he" ? "בטל נבחרים" : "Cancel selected")}
                </button>
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden animate-fade-up stagger-3">
            {!loaded ? (
              <div>
                {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} cols={4} />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-6 py-12 text-center text-gray-400 text-sm">{t.noAppointments}</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="ps-4 pe-1 py-3 w-8">
                      <input
                        type="checkbox"
                        checked={selected.size > 0 && selected.size === cancellableIds.length}
                        onChange={() => toggleSelectAll(cancellableIds)}
                        aria-label={lang === "he" ? "בחר הכל" : "Select all"}
                      />
                    </th>
                    <th className="text-start px-2 py-3 text-gray-500 font-medium">{t.when}</th>
                    <th className="text-start px-4 py-3 text-gray-500 font-medium">{t.customer}</th>
                    <th className="text-start px-4 py-3 text-gray-500 font-medium">{t.service}</th>
                    <th className="text-start px-4 py-3 text-gray-500 font-medium hidden md:table-cell">{t.staff}</th>
                    <th className="text-start px-4 py-3 text-gray-500 font-medium">{t.status}</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a, i) => {
                    const cancellable = a.status === "confirmed" && new Date(a.startTime) >= new Date();
                    return (
                    <tr key={a.id} className={i !== filtered.length - 1 ? "border-b border-gray-200/50" : ""}>
                      <td className="ps-4 pe-1 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(a.id)}
                          onChange={() => toggleSelect(a.id)}
                          disabled={!cancellable}
                        />
                      </td>
                      <td className="px-2 py-3 text-gray-700 whitespace-nowrap text-xs">
                        {formatDateTimeInTz(a.startTime, tz)}
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
                              className="text-gray-400 hover:text-[#1B7FA0] transition px-1.5 py-1 rounded hover:bg-[#E0F5FB]">
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
                  );})}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
