"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface Service { id: string; name: string; description?: string; priceCents: number; durationMin: number }
interface BusinessInfo { id: string; name: string; address?: string; services: Service[] }
interface Slot { startTime: string; endTime: string }

type Step = "service" | "date" | "slot" | "details" | "confirm" | "done";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function isoDate(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export default function BookPage() {
  const { businessId } = useParams<{ businessId: string }>();
  const [info, setInfo] = useState<BusinessInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("service");
  const [service, setService] = useState<Service | null>(null);
  const [dateOffset, setDateOffset] = useState(0);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [booked, setBooked] = useState<{ startTime: string; service: string } | null>(null);

  useEffect(() => {
    fetch(`${API}/api/public/${businessId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setInfo(d);
      })
      .catch(() => setError("Could not load salon information."));
  }, [businessId]);

  async function loadSlots(svc: Service, offset: number) {
    setSlotsLoading(true);
    setSlots([]);
    try {
      const r = await fetch(`${API}/api/public/${businessId}/slots?serviceId=${svc.id}&date=${isoDate(offset)}`);
      const data = await r.json();
      setSlots(Array.isArray(data) ? data : []);
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

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-zinc-500 text-sm">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-start pt-12 px-4 pb-16">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 mb-4 shadow-xl shadow-violet-900/50">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <h1 className="font-[family-name:var(--font-karantina)] text-3xl font-bold text-white tracking-wide">{info.name}</h1>
          {info.address && <p className="text-zinc-500 text-xs mt-1">{info.address}</p>}
        </div>

        {/* Steps */}
        {step === "done" && booked && (
          <div className="bg-zinc-900 border border-green-800 rounded-2xl p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-green-900/40 border border-green-700 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-white font-semibold mb-1">Booking confirmed!</h2>
            <p className="text-zinc-400 text-sm">{booked.service}</p>
            <p className="text-violet-400 text-sm font-medium mt-1">{fmt(booked.startTime)}</p>
            <p className="text-zinc-500 text-xs mt-4">We'll see you then. You can also book via WhatsApp anytime.</p>
          </div>
        )}

        {step === "service" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">Choose a service</h2>
            <div className="flex flex-col gap-2">
              {info.services.map((svc) => (
                <button
                  key={svc.id}
                  onClick={() => pickService(svc)}
                  className="flex items-center justify-between w-full text-left px-4 py-3 rounded-xl border border-zinc-700 hover:border-violet-500 hover:bg-violet-600/10 transition"
                >
                  <div>
                    <div className="text-zinc-100 text-sm font-medium">{svc.name}</div>
                    {svc.description && <div className="text-zinc-500 text-xs mt-0.5">{svc.description}</div>}
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div className="text-violet-400 text-sm font-semibold">₪{(svc.priceCents / 100).toFixed(0)}</div>
                    <div className="text-zinc-600 text-xs">{svc.durationMin} min</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "date" && service && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <button onClick={() => setStep("service")} className="text-xs text-zinc-500 hover:text-zinc-300 mb-4 flex items-center gap-1">← Back</button>
            <h2 className="text-sm font-semibold text-white mb-4">Choose a date for <span className="text-violet-400">{service.name}</span></h2>
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 14 }, (_, i) => i + 1).map((offset) => {
                const d = new Date();
                d.setDate(d.getDate() + offset);
                return (
                  <button
                    key={offset}
                    onClick={() => pickDate(offset)}
                    className="flex flex-col items-center py-2.5 rounded-xl border border-zinc-700 hover:border-violet-500 hover:bg-violet-600/10 transition"
                  >
                    <span className="text-zinc-500 text-xs">{DAYS[d.getDay()]}</span>
                    <span className="text-zinc-100 font-semibold text-sm">{d.getDate()}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === "slot" && service && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <button onClick={() => setStep("date")} className="text-xs text-zinc-500 hover:text-zinc-300 mb-4 flex items-center gap-1">← Back</button>
            <h2 className="text-sm font-semibold text-white mb-4">Available times — {new Date(isoDate(dateOffset) + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h2>
            {slotsLoading ? (
              <p className="text-zinc-500 text-sm text-center py-6">Loading slots…</p>
            ) : slots.length === 0 ? (
              <p className="text-zinc-500 text-sm text-center py-6">No availability on this day. Try another date.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {slots.map((s) => (
                  <button
                    key={s.startTime}
                    onClick={() => pickSlot(s)}
                    className="py-2.5 rounded-xl border border-zinc-700 hover:border-violet-500 hover:bg-violet-600/10 text-zinc-100 text-sm font-medium transition"
                  >
                    {new Date(s.startTime).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === "details" && slot && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <button onClick={() => setStep("slot")} className="text-xs text-zinc-500 hover:text-zinc-300 mb-4 flex items-center gap-1">← Back</button>
            <h2 className="text-sm font-semibold text-white mb-1">Your details</h2>
            <p className="text-zinc-500 text-xs mb-4">{service?.name} · {fmt(slot.startTime)}</p>
            <form onSubmit={submit} className="flex flex-col gap-3">
              <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required className="w-full" />
              <input placeholder="Phone (e.g. 0501234567)" value={phone} onChange={(e) => setPhone(e.target.value)} required className="w-full" />
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="mt-1 w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm transition"
              >
                {submitting ? "Booking…" : "Confirm booking"}
              </button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
