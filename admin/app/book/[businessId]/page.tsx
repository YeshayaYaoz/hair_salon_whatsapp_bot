"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface Service { id: string; name: string; description?: string; priceCents: number; durationMin: number }
interface BusinessInfo { id: string; name: string; address?: string; services: Service[] }
interface Slot { startTime: string; endTime: string }

type Step = "service" | "date" | "slot" | "details" | "done";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function isoDate(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

const STEP_LABELS = ["Service", "Date", "Time", "Details"];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEP_LABELS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${done ? "bg-violet-600 text-white" : active ? "bg-violet-600 text-white ring-4 ring-violet-100" : "bg-gray-100 text-gray-400"}`}>
                {done ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : i + 1}
              </div>
              <span className={`text-[10px] font-medium ${active ? "text-violet-600" : done ? "text-violet-400" : "text-gray-400"}`}>{label}</span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mb-4 ${done ? "bg-violet-400" : "bg-gray-200"}`} />
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
  const [info, setInfo] = useState<BusinessInfo | null>(null);
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
  const [booked, setBooked] = useState<{ startTime: string; service: string } | null>(null);

  useEffect(() => {
    fetch(`${API}/api/public/${businessId}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) setLoadError(d.error); else setInfo(d); })
      .catch(() => setLoadError("Could not load salon information."));
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
      if (!r.ok) throw new Error(data.error ?? "Booking failed");
      setBooked({ startTime: data.startTime, service: data.service });
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
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
          <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Loading…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center pt-10 pb-20 px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 mb-4 shadow-lg shadow-violet-200">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{info.name}</h1>
          {info.address && <p className="text-gray-400 text-xs mt-1">{info.address}</p>}
        </div>

        {step !== "done" && <StepIndicator current={STEP_INDEX[step]} />}

        {/* Done */}
        {step === "done" && booked && (
          <div className="bg-white border border-green-200 rounded-2xl p-6 text-center shadow-sm">
            <div className="w-14 h-14 rounded-full bg-green-50 border-2 border-green-200 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-gray-900 font-semibold text-lg mb-1">Booking confirmed!</h2>
            <p className="text-gray-500 text-sm">{booked.service}</p>
            <p className="text-violet-600 font-semibold text-sm mt-1">{fmt(booked.startTime)}</p>
            <p className="text-gray-400 text-xs mt-5">We'll see you then. You can also manage bookings via WhatsApp.</p>
          </div>
        )}

        {/* Service */}
        {step === "service" && (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Choose a service</h2>
            <div className="flex flex-col gap-2">
              {info.services.map((svc) => (
                <button
                  key={svc.id}
                  onClick={() => pickService(svc)}
                  className="flex items-center justify-between w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-violet-400 hover:bg-violet-50 transition group"
                >
                  <div>
                    <div className="text-gray-800 text-sm font-medium group-hover:text-violet-700 transition">{svc.name}</div>
                    {svc.description && <div className="text-gray-400 text-xs mt-0.5">{svc.description}</div>}
                  </div>
                  <div className="text-right shrink-0 ms-3">
                    <div className="text-violet-600 text-sm font-semibold">₪{(svc.priceCents / 100).toFixed(0)}</div>
                    <div className="text-gray-400 text-xs">{svc.durationMin} min</div>
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
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              Back
            </button>
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Choose a date for <span className="text-violet-600">{service.name}</span></h2>
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 14 }, (_, i) => i + 1).map((offset) => {
                const d = new Date();
                d.setDate(d.getDate() + offset);
                return (
                  <button
                    key={offset}
                    onClick={() => pickDate(offset)}
                    className="flex flex-col items-center py-2.5 rounded-xl border border-gray-200 hover:border-violet-400 hover:bg-violet-50 transition"
                  >
                    <span className="text-gray-400 text-xs">{DAYS[d.getDay()]}</span>
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
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              Back
            </button>
            <h2 className="text-sm font-semibold text-gray-900 mb-4">
              {new Date(isoDate(dateOffset) + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </h2>
            {slotsLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : slots.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-400 text-sm">No availability on this day.</p>
                <button onClick={() => setStep("date")} className="text-violet-600 text-xs mt-2 hover:underline">Try another date</button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {slots.map((s) => (
                  <button
                    key={s.startTime}
                    onClick={() => pickSlot(s)}
                    className="py-2.5 rounded-xl border border-gray-200 hover:border-violet-400 hover:bg-violet-50 text-gray-700 text-sm font-medium transition"
                  >
                    {new Date(s.startTime).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
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
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              Back
            </button>
            <div className="bg-violet-50 border border-violet-100 rounded-xl px-4 py-3 mb-4">
              <div className="text-xs font-semibold text-violet-700">{service?.name}</div>
              <div className="text-xs text-violet-500 mt-0.5">{fmt(slot.startTime)}</div>
            </div>
            <form onSubmit={submit} className="flex flex-col gap-3">
              <input
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent"
              />
              <input
                placeholder="Phone (e.g. 0501234567)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent"
              />
              {error && <p className="text-red-500 text-xs">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="mt-1 w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm transition shadow-sm shadow-violet-200"
              >
                {submitting ? "Booking…" : "Confirm booking"}
              </button>
            </form>
          </div>
        )}

        <p className="text-center text-gray-400 text-[11px] mt-8">Powered by <span className="font-semibold text-gray-500">תורי</span></p>
      </div>
    </main>
  );
}
