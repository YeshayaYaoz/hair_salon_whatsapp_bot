"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { formatTimeInTz, formatDateTimeInTz, partsInTz, dayKeyInTz, formatDateIn, localeFor, describeLocalInput } from "../../lib/tz";
import { SkeletonBlock, SkeletonRow } from "../../lib/Skeleton";
import { EmptyState } from "../../lib/EmptyState";
import { formatPhone } from "../../lib/formatPhone";
import { useDialog } from "../../lib/useDialog";
import { requiredField } from "../../lib/validation";

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Appointment {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  depositAmountIls?: number | null;
  depositStatus?: string | null;
  customer: { name?: string; phone: string };
  service: { name: string };
  staff?: { name: string } | null;
}

// All four are light-theme tints. `cancelled` and `pending` previously carried bg-red-950/bg-yellow-950
// with light text — leftovers from the old dark theme that rendered as a near-black chip in the
// middle of a light table, next to their bg-*-50 siblings.
const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-green-50 text-green-700 border-green-200",
  cancelled: "bg-red-50 text-red-700 border-red-200",
  pending: "bg-yellow-50 text-yellow-800 border-yellow-300",
  pending_payment: "bg-amber-50 text-amber-700 border-amber-200",
};

type Filter = "upcoming" | "past" | "cancelled" | "all";
type ViewMode = "list" | "calendar";

/**
 * "N customers are waiting" — shown only when someone is, linking to the list.
 *
 * The mobile dock puts the waitlist's count on the bookings tab, since pricing keeps the fourth
 * tab slot and the waitlist lives behind "More". A badge that leads to a screen with no mention of
 * what it counted is worse than no badge, so this is where that tap arrives.
 *
 * Counts un-notified entries, matching the badge and the waitlist page's own "pending" split: an
 * entry stays on the list after the owner replies, so counting all of them would never clear.
 */
function WaitlistCallout() {
  const { t, lang } = useLanguage();
  const he = lang === "he";
  const [pending, setPending] = useState(0);

  useEffect(() => {
    apiFetch<{ waitlist: number }>("/api/business/me/nav-badges")
      .then((b) => setPending(b.waitlist ?? 0))
      .catch(() => {});
  }, []);

  if (pending === 0) return null;

  return (
    <Link
      href="/dashboard/waitlist"
      className="mb-5 flex items-center gap-3 rounded-xl px-4 py-3 transition"
      style={{ background: "#FFF7ED", border: "1px solid #FED7AA" }}
    >
      <span
        className="shrink-0 min-w-[24px] h-6 px-1.5 rounded-full flex items-center justify-center text-xs font-bold tabular-nums"
        style={{ background: "#B91C1C", color: "#FFFFFF" }}
        aria-hidden
      >
        {pending}
      </span>
      <span className="flex-1 text-sm font-semibold" style={{ color: "#7C2D12" }}>
        {he
          ? `${pending} ${pending === 1 ? "לקוח ממתין" : "לקוחות ממתינים"} שיתפנה מקום`
          : `${pending} ${pending === 1 ? "customer is" : "customers are"} waiting for a slot`}
      </span>
      <span className="shrink-0 text-sm font-semibold" style={{ color: "#9A3412" }}>
        {t.waitlistTitle} {he ? "←" : "→"}
      </span>
    </Link>
  );
}

function GoogleCalendarSection() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ connected: boolean }>("/api/business/google-calendar/status")
      .then((r) => setConnected(r.connected))
      .catch(() => setConnected(false));
  }, []);

  // Handle OAuth callback code in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("gcal_code");
    if (!code) return;
    window.history.replaceState({}, "", window.location.pathname);
    apiFetch("/api/business/google-calendar/callback", {
      method: "POST",
      body: JSON.stringify({ code }),
    })
      .then(() => setConnected(true))
      .catch((err) => alert("Google Calendar connection failed: " + err.message));
  }, []);

  async function connect() {
    setLoading(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/business/google-calendar/auth-url");
      window.location.href = url;
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    if (!confirm(he ? "לנתק את גוגל קלנדר?" : "Disconnect Google Calendar?")) return;
    await apiFetch("/api/business/google-calendar", { method: "DELETE" });
    setConnected(false);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-0.5 flex items-center gap-2">
            {/* SVG rather than 📅: the emoji renders with a baked-in "17" on most platforms, which
                on a Google Calendar connect card reads as a date the salon didn't choose. */}
            <svg className="w-4 h-4 text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Google Calendar
          </h2>
          <p className="text-xs text-gray-600">
            {connected
              ? (he ? "כל תור שנקבע מסתנכרן אוטומטית לגוגל קלנדר שלך." : "Every booked appointment syncs to your Google Calendar automatically.")
              : (he ? "חבר את גוגל קלנדר כדי שתורים יופיעו שם אוטומטית." : "Connect Google Calendar so appointments show up there automatically.")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {connected === null ? (
            <span className="text-xs text-zinc-600">{he ? "טוען..." : "Loading..."}</span>
          ) : connected ? (
            <>
              <span className="flex items-center gap-1.5 text-xs text-green-700 font-medium">
                <span className="w-2 h-2 rounded-full bg-green-400 inline-block"></span>
                {he ? "מחובר" : "Connected"}
              </span>
              <button
                onClick={disconnect}
                className="text-xs text-gray-600 hover:text-red-600 transition border border-gray-200 hover:border-red-200 px-3 py-1.5 rounded-lg"
              >
                {he ? "נתק" : "Disconnect"}
              </button>
            </>
          ) : (
            <button
              onClick={connect}
              disabled={loading}
              className="flex items-center gap-2 bg-white hover:bg-zinc-100 text-zinc-900 text-xs font-semibold px-3 py-2 rounded-lg transition disabled:opacity-50 border border-gray-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              {loading ? (he ? "מחבר..." : "Connecting...") : (he ? "חבר Google Calendar" : "Connect Google Calendar")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function NewAppointmentModal({ tz, onClose, onCreated }: { tz: string; onClose: () => void; onCreated: () => void }) {
  const { lang } = useLanguage();
  const he = lang === "he";
  const dialogRef = useDialog<HTMLFormElement>(onClose);
  const req = requiredField(he ? "יש למלא שדה זה" : "Please fill out this field");
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-appt-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl flex flex-col gap-4 animate-fade-up"
        dir={he ? "rtl" : "ltr"}
      >
        <h2 id="new-appt-title" className="text-lg font-bold text-gray-900">{he ? "תור חדש (ידני)" : "New appointment (manual)"}</h2>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">{he ? "שירות" : "Service"}</label>
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} {...req} className="w-full">
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">{he ? "שם הלקוח" : "Customer name"}</label>
          <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} {...req} className="w-full" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">{he ? "טלפון" : "Phone"}</label>
          <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} {...req} placeholder="972501234567" className="w-full" dir="ltr" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">{he ? "מועד" : "Date & time"}</label>
          <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} {...req} className="w-full" dir="ltr" />
          {/* The native picker follows the BROWSER's locale, so it can offer mm/dd/yyyy and a 12-hour
              clock to a Hebrew-speaking owner. Echoing the choice back in their own format is what
              makes a wrong date visible before it's saved. */}
          {describeLocalInput(startTime, localeFor(lang), true) && (
            <p className="text-[11px] font-medium text-[#145F78] mt-1">{describeLocalInput(startTime, localeFor(lang), true)}</p>
          )}
          <p className="text-[11px] text-gray-600 mt-0.5">{he ? `לפי אזור הזמן ${tz}` : `In timezone ${tz}`}</p>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex items-center gap-2 justify-end">
          <button type="button" onClick={onClose} className="text-sm text-gray-600 hover:text-gray-800 px-4 py-2">
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

// tz and locale are passed in rather than defaulted: toLocaleDateString()/toLocaleTimeString([])
// use the VIEWER's zone and locale, so an owner travelling — or a server-rendered export — got
// appointment times that don't match their own calendar.
function exportCsv(appointments: Appointment[], tz: string, locale: string) {
  const rows = [
    ["Date", "Time", "Customer Name", "Phone", "Service", "Staff", "Status"],
    ...appointments.map((a) => [
      formatDateIn(new Date(a.startTime), locale, { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }),
      formatTimeInTz(a.startTime, tz, locale),
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
  openHour,
  closeHour,
}: {
  appointments: Appointment[];
  weekStart: Date;
  onCancel: (id: string) => void;
  cancellingId: string | null;
  tz: string;
  openHour: number;
  closeHour: number;
}) {
  const { t } = useLanguage();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  // Was a hardcoded 07:00-21:00 for every salon. A 09:00-19:00 shop got four permanently empty
  // rows, which on a phone is a lot of dead scrolling before the first bookable hour. One hour of
  // padding either side keeps an early or late booking from being clipped out of view.
  const hours = Array.from({ length: Math.max(closeHour - openHour + 1, 1) }, (_, i) => i + openHour);

  // The salon's today, so the highlighted column matches the salon's clock rather than a viewer
  // device that may still be on yesterday.
  const todayKey = dayKeyInTz(new Date(), tz);

  // Phones get one day at a time instead of seven columns. At 390px each column was ~44px wide,
  // so an appointment chip had room for two or three characters of a customer's name — present,
  // but unreadable. Defaults to today when today is in view, otherwise the first day of the week.
  const todayIndex = days.findIndex((d) => localDayKey(d) === todayKey);
  const [mobileDay, setMobileDay] = useState(0);
  useEffect(() => { setMobileDay(todayIndex >= 0 ? todayIndex : 0); }, [todayIndex, weekStart]);
  const shownDay = days[Math.min(mobileDay, days.length - 1)] ?? days[0];
  const shownAppts = apptsByDay(shownDay).slice().sort((a, b) => a.startTime.localeCompare(b.startTime));

  function apptsByDay(day: Date) {
    const key = localDayKey(day);
    // Include pending_payment holds too — they block the slot exactly like a confirmed booking
    // (see availability.ts), so hiding them here would make an occupied slot look empty.
    return appointments.filter((a) => dayKeyInTz(a.startTime, tz) === key && (a.status === "confirmed" || a.status === "pending_payment"));
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* ── Phone: one day at a time ───────────────────────────────────────────────────────── */}
      <div className="md:hidden">
        <div className="flex border-b border-gray-200" role="tablist" aria-label={t.calendarView}>
          {days.map((d, i) => {
            const today = localDayKey(d) === todayKey;
            const selected = i === Math.min(mobileDay, days.length - 1);
            const count = apptsByDay(d).length;
            return (
              <button
                key={d.toISOString()}
                role="tab"
                aria-selected={selected}
                onClick={() => setMobileDay(i)}
                className={`flex-1 py-2 flex flex-col items-center gap-0.5 border-b-2 transition ${
                  selected ? "border-[#1B7FA0] bg-[#E0F5FB]/50" : "border-transparent"
                }`}
              >
                <span className={`text-[11px] ${today ? "text-[#145F78] font-semibold" : "text-gray-600"}`}>{t.daysShort[d.getDay()]}</span>
                <span className={`text-sm font-semibold ${selected ? "text-[#145F78]" : today ? "text-[#197492]" : "text-gray-700"}`}>{d.getDate()}</span>
                {/* A dot rather than a number: at this width a count competes with the date. */}
                <span className={`w-1.5 h-1.5 rounded-full ${count > 0 ? (selected ? "bg-[#145F78]" : "bg-[#1B7FA0]/50") : "bg-transparent"}`} />
              </button>
            );
          })}
        </div>
        {shownAppts.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-gray-600">{t.noAppointments}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {shownAppts.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                <span className="text-sm font-bold tabular-nums text-[#145F78] shrink-0 w-12">{formatTimeInTz(a.startTime, tz)}</span>
                <span className={`w-1 self-stretch rounded-full shrink-0 ${a.status === "pending_payment" ? "bg-amber-500" : "bg-[#1B7FA0]"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {a.customer.name ?? <span dir="ltr">{formatPhone(a.customer.phone)}</span>}
                  </p>
                  <p className="text-xs text-gray-600 truncate">
                    {a.status === "pending_payment" ? `⏳ ${t.awaitingDeposit}` : a.service.name}
                    {a.staff ? ` · ${a.staff.name}` : ""}
                  </p>
                </div>
                {new Date(a.startTime) >= new Date() && (
                  <button
                    onClick={() => onCancel(a.id)}
                    disabled={cancellingId === a.id}
                    className="row-action text-xs text-gray-600 hover:text-red-600 px-2 rounded-lg hover:bg-red-50 transition shrink-0"
                  >
                    {t.cancel}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Desktop: the full week grid ─────────────────────────────────────────────────────── */}
      <div className="hidden md:block">
      {/* Day headers */}
      <div className="grid border-b border-gray-200" style={{ gridTemplateColumns: "3.5rem repeat(7, 1fr)" }}>
        <div className="px-2 py-2 border-e border-gray-100" />
        {days.map((d) => {
          const today = localDayKey(d) === todayKey;
          return (
            <div key={d.toISOString()} className={`px-1 py-2 text-center border-e border-gray-100 last:border-e-0 ${today ? "bg-[#E0F5FB]" : ""}`}>
              <div className="text-xs text-gray-600">{t.daysShort[d.getDay()]}</div>
              <div className={`text-sm font-semibold ${today ? "text-[#197492]" : "text-gray-700"}`}>{d.getDate()}</div>
            </div>
          );
        })}
      </div>

      {/* Time grid — renders in full; the page itself scrolls rather than nesting another scrollbar */}
      <div>
        {hours.map((h) => (
          <div key={h} className="grid border-b border-gray-100/70 last:border-b-0" style={{ gridTemplateColumns: "3.5rem repeat(7, 1fr)", minHeight: 48 }}>
            <div className="px-2 pt-1 text-xs text-gray-600 border-e border-gray-100 leading-none">{h}:00</div>
            {days.map((d) => {
              const appts = apptsByDay(d).filter((a) => partsInTz(a.startTime, tz).hour === h);
              const today = localDayKey(d) === todayKey;
              return (
                <div key={d.toISOString()} className={`border-e border-gray-100 last:border-e-0 p-0.5 flex flex-col gap-0.5 ${today ? "bg-[#E0F5FB]/40" : ""}`}>
                  {appts.map((a) => (
                    <div
                      key={a.id}
                      className={`rounded px-1.5 py-1 text-[10px] leading-tight cursor-default transition group relative text-white ${
                        a.status === "pending_payment" ? "bg-amber-500 hover:bg-amber-600" : "bg-[#1B7FA0] hover:bg-[#2A9BBF]"
                      }`}
                      title={`${a.customer.name ?? formatPhone(a.customer.phone)} · ${a.service.name}${a.status === "pending_payment" ? ` · ⏳ ${t.awaitingDeposit}` : ""}`}
                    >
                      <div className="font-semibold truncate">{formatTimeInTz(a.startTime, tz)}</div>
                      <div className="truncate opacity-80">{a.customer.name ?? <span dir="ltr">{formatPhone(a.customer.phone)}</span>}</div>
                      <div className="truncate opacity-70">{a.status === "pending_payment" ? `⏳ ${t.awaitingDeposit}` : a.service.name}</div>
                      {new Date(a.startTime) >= new Date() && (
                        // Cancelling is destructive, so this must never be invisible-but-clickable.
                        // It stays visible by default (touch devices have no hover, and previously
                        // this was unreachable there while still being tappable); only pointer
                        // devices get the reveal-on-hover treatment, and then `pointer-events-none`
                        // while hidden means a click can't land on something nobody can see.
                        // focus-visible brings it back for keyboard users, who could otherwise
                        // trigger a cancel they had no way to perceive.
                        <button
                          onClick={() => onCancel(a.id)}
                          disabled={cancellingId === a.id}
                          className="absolute top-0 end-0 grid place-items-center w-5 h-5 rounded text-white/80
                            hover:text-white hover:bg-black/25 transition leading-none
                            [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:pointer-events-none
                            [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-hover:pointer-events-auto
                            focus-visible:opacity-100 focus-visible:pointer-events-auto"
                          aria-label={`${t.cancel} — ${a.customer.name ?? formatPhone(a.customer.phone)}`}
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
  // Opening window for the calendar grid, padded an hour each side. Defaults to 07:00-21:00 so
  // the grid looks the same as before until hours load (or if the salon hasn't set any yet).
  const [openHour, setOpenHour] = useState(7);
  const [closeHour, setCloseHour] = useState(21);
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
    apiFetch<{ dayOfWeek: number; openMin: number; closeMin: number }[]>("/api/business/hours")
      .then((rows) => {
        if (!rows.length) return;
        const earliest = Math.min(...rows.map((r) => Math.floor(r.openMin / 60)));
        const latest = Math.max(...rows.map((r) => Math.ceil(r.closeMin / 60)));
        setOpenHour(Math.max(0, earliest - 1));
        setCloseHour(Math.min(23, latest + 1));
      })
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
    () => filtered.filter((a) => (a.status === "confirmed" || a.status === "pending_payment") && new Date(a.startTime) >= new Date()).map((a) => a.id),
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
          <p className="text-gray-600 text-sm mt-1">{t.appointmentsSubtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
            {(["list", "calendar"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`text-xs font-medium px-3 py-1.5 rounded-md transition ${view === v ? "bg-[#1B7FA0] text-white" : "text-gray-600 hover:text-gray-800"}`}
              >
                {v === "list" ? t.listView : t.calendarView}
              </button>
            ))}
          </div>
          <button
            onClick={() => exportCsv(filtered, tz, localeFor(lang))}
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

      {/* The bookings tab carries the waitlist's badge, because the waitlist has no tab of its own.
          Without this the badge would be a dead end: you'd tap a count and land somewhere that
          never mentions what it was counting. This is the other half of that. */}
      <WaitlistCallout />

      <GoogleCalendarSection />

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
            {/* rtl:-scale-x-100 mirrors the chevron: in RTL the flex row reverses, so this button
                sits on the right, where "previous" has to point right to read as going back. */}
            <button
              onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d); }}
              className="row-action p-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 transition"
              aria-label={t.previousWeek}
            >
              <svg className="w-4 h-4 text-gray-600 rtl:-scale-x-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm font-medium text-gray-700">
              {formatDateIn(weekStart, localeFor(lang), { month: "short", day: "numeric" })} — {formatDateIn(weekEnd, localeFor(lang), { month: "short", day: "numeric", year: "numeric" })}
            </span>
            <button
              onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d); }}
              className="row-action p-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 transition"
              aria-label={t.nextWeek}
            >
              <svg className="w-4 h-4 text-gray-600 rtl:-scale-x-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <button
              onClick={() => setWeekStart(startOfWeek(new Date()))}
              className="row-action text-xs text-[#145F78] hover:text-[#0F4A5E] font-medium px-2 py-1 rounded-lg hover:bg-[#E0F5FB] transition"
            >
              {t.today}
            </button>
          </div>
          {loaded ? (
            <WeekCalendar
              appointments={appointments}
              weekStart={weekStart}
              onCancel={cancel}
              cancellingId={cancellingId}
              tz={tz}
              openHour={openHour}
              closeHour={closeHour}
            />
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {/* Two skeletons, because the loaded views differ: a phone gets the day tabs + agenda,
                  a desktop gets the week grid. One shape standing in for the other makes the layout
                  visibly jump the moment data lands. */}
              <div className="md:hidden">
                <div className="flex border-b border-gray-200">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="flex-1 py-2 flex flex-col items-center gap-1">
                      <SkeletonBlock className="h-2.5 w-5" />
                      <SkeletonBlock className="h-4 w-4" />
                    </div>
                  ))}
                </div>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0">
                    <SkeletonBlock className="h-4 w-10 shrink-0" />
                    <div className="flex-1 flex flex-col gap-1.5">
                      <SkeletonBlock className="h-3 w-28" />
                      <SkeletonBlock className="h-2.5 w-20" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden md:block">
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
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition ${filter === f.key ? "bg-[#1B7FA0] text-white" : "text-gray-600 hover:text-gray-800"}`}
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
                <span className="text-xs text-gray-600">
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
              <EmptyState
                icon="📅"
                title={t.noAppointments}
                hint={lang === "he"
                  ? "ברגע שלקוח יקבע תור בוואטסאפ — הוא יופיע כאן אוטומטית."
                  : "As soon as a customer books via WhatsApp, it will show up here automatically."}
              />
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
                    <th className="text-start px-2 py-3 text-gray-600 font-medium">{t.when}</th>
                    <th className="text-start px-4 py-3 text-gray-600 font-medium">{t.customer}</th>
                    <th className="text-start px-4 py-3 text-gray-600 font-medium">{t.service}</th>
                    <th className="text-start px-4 py-3 text-gray-600 font-medium hidden md:table-cell">{t.staff}</th>
                    <th className="text-start px-4 py-3 text-gray-600 font-medium">{t.status}</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a, i) => {
                    const cancellable = (a.status === "confirmed" || a.status === "pending_payment") && new Date(a.startTime) >= new Date();
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
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-[#1B7FA0]/10 text-[#197492] flex items-center justify-center text-xs font-bold shrink-0">
                            {(a.customer.name ?? "?").trim().charAt(0) || "?"}
                          </div>
                          <div className="min-w-0">
                            <div className="text-gray-700 font-medium text-sm truncate">{a.customer.name ?? "—"}</div>
                            <div className="text-gray-600 text-xs" dir="ltr">{formatPhone(a.customer.phone)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-sm">{a.service.name}</td>
                      <td className="px-4 py-3 text-gray-600 text-sm hidden md:table-cell">{a.staff?.name ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLES[a.status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                          {a.status === "confirmed" ? (lang === "he" ? "מאושר" : "Confirmed")
                            : a.status === "cancelled" ? (lang === "he" ? "בוטל" : "Cancelled")
                            : a.status === "pending_payment" ? `⏳ ${t.awaitingDeposit}${a.depositAmountIls ? ` ₪${a.depositAmountIls}` : ""}`
                            : a.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-end">
                        <div className="flex items-center justify-end gap-1">
                          {a.status === "confirmed" && (
                            <a href={googleCalendarUrl(a)} target="_blank" rel="noopener noreferrer" title="Add to Google Calendar"
                              className="text-gray-600 hover:text-[#197492] transition px-1.5 py-1 rounded hover:bg-[#E0F5FB]">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </a>
                          )}
                          {a.status === "confirmed" && new Date(a.startTime) >= new Date() && (
                            <button onClick={() => cancel(a.id)} disabled={cancellingId === a.id}
                              className="row-action text-xs text-gray-600 hover:text-red-600 disabled:opacity-50 transition px-2 py-1 rounded hover:bg-red-50">
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
