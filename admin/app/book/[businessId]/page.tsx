"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useLanguage } from "../../lib/LanguageContext";
import { formatDateTimeInTz, localeFor } from "../../lib/tz";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface Service { id: string; name: string; description?: string; priceCents: number; durationMin: number }
interface BusinessInfo { id: string; name: string; address?: string; timezone?: string; services: Service[] }
interface Slot { startTime: string; endTime: string }

type Step = "service" | "date" | "slot" | "details" | "done";

/** This page is the only one a salon's own customers ever see, and it had no i18n at all — every
 *  string was hardcoded English while the document renders RTL, so even "30 min" came out reordered
 *  as "min 30". Copy lives here rather than in lib/i18n.ts because none of it is shared with the
 *  owner-facing dashboard. */
const COPY = {
  he: {
    steps: ["שירות", "תאריך", "שעה", "פרטים"],
    loading: "טוען…",
    loadFailed: "לא הצלחנו לטעון את פרטי העסק.",
    chooseService: "בחרו שירות",
    chooseDateFor: "בחרו תאריך ל",
    back: "חזרה",
    noAvailability: "אין זמינות ביום הזה.",
    tryAnotherDate: "נסו תאריך אחר",
    yourName: "השם שלכם",
    phonePlaceholder: "טלפון (לדוגמה 0501234567)",
    booking: "קובעים…",
    confirmBooking: "אישור הזמנה",
    bookingFailed: "ההזמנה נכשלה",
    somethingWrong: "משהו השתבש. נסו שוב.",
    confirmed: "התור נקבע!",
    seeYouThen: "נתראה! אפשר גם לנהל את התורים דרך וואטסאפ.",
    holdTitle: "כמעט סיימנו — נשארה המקדמה",
    holdBody: "שמרנו לכם את המועד. כדי לאשר אותו סופית צריך לשלם מקדמה של",
    holdExpiry: "המקום שמור עבורכם ל־",
    payNow: "לתשלום המקדמה",
    holdWarning: "בלי התשלום המועד ישוחרר אוטומטית וייפתח לאחרים.",
    poweredBy: "מופעל על ידי",
    minutesShort: "דק׳",
  },
  en: {
    steps: ["Service", "Date", "Time", "Details"],
    loading: "Loading…",
    loadFailed: "Could not load salon information.",
    chooseService: "Choose a service",
    chooseDateFor: "Choose a date for ",
    back: "Back",
    noAvailability: "No availability on this day.",
    tryAnotherDate: "Try another date",
    yourName: "Your name",
    phonePlaceholder: "Phone (e.g. 0501234567)",
    booking: "Booking…",
    confirmBooking: "Confirm booking",
    bookingFailed: "Booking failed",
    somethingWrong: "Something went wrong",
    confirmed: "Booking confirmed!",
    seeYouThen: "We'll see you then. You can also manage bookings via WhatsApp.",
    holdTitle: "Almost there — deposit required",
    holdBody: "We're holding your time slot. To confirm it, pay a deposit of",
    holdExpiry: "Your slot is held for",
    payNow: "Pay the deposit",
    holdWarning: "Without payment the slot is released automatically and opens up to others.",
    poweredBy: "Powered by",
    minutesShort: "min",
  },
} as const;

/** Local calendar date `offset` days from today. Built from local date parts rather than
 *  `toISOString().slice(0, 10)`, which converts to UTC first and so returns the wrong day for
 *  anyone east of Greenwich during the evening — including the whole of Israel. */
function isoDate(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function StepIndicator({ current, labels }: { current: number; labels: readonly string[] }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {labels.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${done ? "bg-[#1B7FA0] text-white" : active ? "bg-[#1B7FA0] text-white ring-4 ring-[#D6F0F8]" : "bg-gray-100 text-gray-400"}`}>
                {done ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : i + 1}
              </div>
              <span className={`text-[10px] font-medium ${active ? "text-[#1B7FA0]" : done ? "text-[#5BB8D4]" : "text-gray-400"}`}>{label}</span>
            </div>
            {i < labels.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mb-4 ${done ? "bg-[#5BB8D4]" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

const STEP_INDEX: Record<Step, number> = { service: 0, date: 1, slot: 2, details: 3, done: 3 };

export default function BookPage() {
  const { businessId } = useParams<{ businessId: string }>();
  const { lang } = useLanguage();
  const c = COPY[lang === "he" ? "he" : "en"];
  const locale = localeFor(lang);
  const [info, setInfo] = useState<BusinessInfo | null>(null);
  // Slot times are absolute instants; render them in the salon's zone, not the visitor's device
  // zone, or someone browsing from abroad books a time that isn't the one they were shown.
  const tz = info?.timezone ?? "Asia/Jerusalem";
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("service");
  const [service, setService] = useState<Service | null>(null);
  const [dateOffset, setDateOffset] = useState(0);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<{
    startTime: string;
    service: string;
    // Present only when the salon requires a deposit: the booking is a hold, not a confirmation,
    // until this link is paid. Showing the usual "Booking confirmed!" here would be a lie that
    // costs the customer their slot when the hold expires.
    deposit?: { paymentUrl: string; amountIls: number; holdMinutes: number };
  } | null>(null);

  useEffect(() => {
    fetch(`${API}/api/public/${businessId}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) setLoadError(d.error); else setInfo(d); })
      .catch(() => setLoadError(c.loadFailed));
  }, [businessId]);

  async function loadSlots(svc: Service, offset: number) {
    setSlotsLoading(true);
    setSlots([]);
    try {
      const r = await fetch(`${API}/api/public/${businessId}/slots?serviceId=${svc.id}&date=${isoDate(offset)}`);
      setSlots(await r.json().then((d) => Array.isArray(d) ? d : []));
    } finally {
      setSlotsLoading(false);
    }
  }

  function pickService(svc: Service) {
    setService(svc);
    setDateOffset(0);
    setStep("date");
  }

  async function pickDate(offset: number) {
    setDateOffset(offset);
    setStep("slot");
    await loadSlots(service!, offset);
  }

  function pickSlot(s: Slot) {
    setSlot(s);
    setStep("details");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!service || !slot) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`${API}/api/public/${businessId}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: service.id, startTime: slot.startTime, customerName: name, customerPhone: phone }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? c.bookingFailed);
      setBooked({
        startTime: data.startTime,
        service: data.service,
        ...(data.depositRequired
          ? { deposit: { paymentUrl: data.paymentUrl, amountIls: data.depositAmountIls, holdMinutes: data.holdMinutes } }
          : {}),
      });
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : c.somethingWrong);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white border border-red-200 rounded-2xl p-8 text-center max-w-sm w-full">
          <div className="w-12 h-12 rounded-full bg-red-50 border border-red-200 flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-gray-600 text-sm">{loadError}</p>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#1B7FA0] border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">{c.loading}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center pt-10 pb-20 px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-[#2A9BBF] to-[#145F78] mb-4 shadow-lg shadow-[#1B7FA0]-200">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{info.name}</h1>
          {info.address && <p className="text-gray-400 text-xs mt-1">{info.address}</p>}
        </div>

        {step !== "done" && <StepIndicator current={STEP_INDEX[step]} labels={c.steps} />}

        {/* Held, awaiting a deposit — deliberately NOT the green confirmation below. The slot is
            only reserved for holdMinutes, so telling this customer they're booked would cost them
            the appointment when the hold expires. */}
        {step === "done" && booked?.deposit && (
          <div className="bg-white border-2 rounded-2xl p-6 text-center shadow-sm" style={{ borderColor: "#FDE68A" }}>
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#FFFBEB", border: "2px solid #FDE68A" }}>
              <svg className="w-7 h-7" style={{ color: "#B45309" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-gray-900 font-semibold text-lg mb-1">{c.holdTitle}</h2>
            <p className="text-gray-500 text-sm">{booked.service}</p>
            <p className="text-[#1B7FA0] font-semibold text-sm mt-1">{formatDateTimeInTz(booked.startTime, tz, locale)}</p>

            <p className="text-gray-600 text-sm mt-4">
              {c.holdBody} <span className="font-bold text-gray-900">₪{booked.deposit.amountIls}</span>
            </p>

            <a
              href={booked.deposit.paymentUrl}
              className="mt-4 inline-flex items-center justify-center w-full py-3 rounded-xl font-semibold text-white transition"
              style={{ background: "#1B7FA0" }}
            >
              {c.payNow}
            </a>

            {/* The Hebrew prefix ends in a maqaf and binds directly to the number ("ל־30 דק׳"),
                so it must not be separated by a space the way the English reading needs. */}
            <p className="text-gray-500 text-xs mt-3">
              {c.holdExpiry}
              {lang === "he" ? "" : " "}
              {booked.deposit.holdMinutes} {c.minutesShort}
            </p>
            <p className="text-xs mt-1" style={{ color: "#B45309" }}>{c.holdWarning}</p>
          </div>
        )}

        {/* Done */}
        {step === "done" && booked && !booked.deposit && (
          <div className="bg-white border border-green-200 rounded-2xl p-6 text-center shadow-sm">
            <div className="w-14 h-14 rounded-full bg-green-50 border-2 border-green-200 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-gray-900 font-semibold text-lg mb-1">{c.confirmed}</h2>
            <p className="text-gray-500 text-sm">{booked.service}</p>
            <p className="text-[#1B7FA0] font-semibold text-sm mt-1">{formatDateTimeInTz(booked.startTime, tz, locale)}</p>
            <p className="text-gray-400 text-xs mt-5">{c.seeYouThen}</p>
          </div>
        )}

        {/* Service */}
        {step === "service" && (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">{c.chooseService}</h2>
            <div className="flex flex-col gap-2">
              {info.services.map((svc) => (
                <button
                  key={svc.id}
                  onClick={() => pickService(svc)}
                  className="flex items-center justify-between w-full text-start px-4 py-3 rounded-xl border border-gray-200 hover:border-[#5BB8D4] hover:bg-[#E0F5FB] transition group"
                >
                  <div>
                    <div className="text-gray-800 text-sm font-medium group-hover:text-[#145F78] transition">{svc.name}</div>
                    {svc.description && <div className="text-gray-400 text-xs mt-0.5">{svc.description}</div>}
                  </div>
                  <div className="text-end shrink-0 ms-3">
                    <div className="text-[#1B7FA0] text-sm font-semibold">₪{(svc.priceCents / 100).toFixed(0)}</div>
                    <div className="text-gray-400 text-xs">{svc.durationMin} {c.minutesShort}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Date */}
        {step === "date" && service && (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <button onClick={() => setStep("service")} className="text-xs text-gray-400 hover:text-gray-600 mb-4 flex items-center gap-1 transition">
              <svg className="w-3 h-3 rtl:-scale-x-100" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              {c.back}
            </button>
            <h2 className="text-sm font-semibold text-gray-900 mb-4">{c.chooseDateFor}<span className="text-[#1B7FA0]">{service.name}</span></h2>
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 14 }, (_, i) => i + 1).map((offset) => {
                // Anchored at noon on the same calendar date `isoDate` sends to the API, so the
                // label can never name a different day than the one being requested. No timeZone
                // here on purpose: this is a plain calendar date, not an instant.
                const d = new Date(isoDate(offset) + "T12:00:00");
                return (
                  <button
                    key={offset}
                    onClick={() => pickDate(offset)}
                    className="flex flex-col items-center py-2.5 rounded-xl border border-gray-200 hover:border-[#5BB8D4] hover:bg-[#E0F5FB] transition"
                  >
                    <span className="text-gray-400 text-xs">{d.toLocaleDateString(locale, { weekday: "short" })}</span>
                    <span className="text-gray-800 font-semibold text-sm">{d.getDate()}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Slot */}
        {step === "slot" && service && (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <button onClick={() => setStep("date")} className="text-xs text-gray-400 hover:text-gray-600 mb-4 flex items-center gap-1 transition">
              <svg className="w-3 h-3 rtl:-scale-x-100" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              {c.back}
            </button>
            <h2 className="text-sm font-semibold text-gray-900 mb-4">
              {new Date(isoDate(dateOffset) + "T12:00:00").toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" })}
            </h2>
            {slotsLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-[#2A9BBF] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : slots.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-400 text-sm">{c.noAvailability}</p>
                <button onClick={() => setStep("date")} className="text-[#1B7FA0] text-xs mt-2 hover:underline">{c.tryAnotherDate}</button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {slots.map((s) => (
                  <button
                    key={s.startTime}
                    onClick={() => pickSlot(s)}
                    className="py-2.5 rounded-xl border border-gray-200 hover:border-[#5BB8D4] hover:bg-[#E0F5FB] text-gray-700 text-sm font-medium transition"
                  >
                    {new Date(s.startTime).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: tz })}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Details */}
        {step === "details" && slot && (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <button onClick={() => setStep("slot")} className="text-xs text-gray-400 hover:text-gray-600 mb-4 flex items-center gap-1 transition">
              <svg className="w-3 h-3 rtl:-scale-x-100" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              {c.back}
            </button>
            <div className="bg-[#E0F5FB] border border-[#D6F0F8] rounded-xl px-4 py-3 mb-4">
              <div className="text-xs font-semibold text-[#145F78]">{service?.name}</div>
              <div className="text-xs text-[#2A9BBF] mt-0.5">{formatDateTimeInTz(slot.startTime, tz, locale)}</div>
            </div>
            <form onSubmit={submit} className="flex flex-col gap-3">
              <input
                placeholder={c.yourName}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#5BB8D4] focus:border-transparent"
              />
              <input
                placeholder={c.phonePlaceholder}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#5BB8D4] focus:border-transparent"
              />
              {error && <p className="text-red-500 text-xs">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="mt-1 w-full bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm transition shadow-sm shadow-[#1B7FA0]-200"
              >
                {submitting ? c.booking : c.confirmBooking}
              </button>
            </form>
          </div>
        )}

        <p className="text-center text-gray-400 text-[11px] mt-8">{c.poweredBy} <span className="font-semibold text-gray-500">תורי</span></p>
      </div>
    </main>
  );
}
