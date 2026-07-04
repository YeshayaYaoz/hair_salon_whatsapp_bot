"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SavedBadge } from "../../lib/SavedBadge";

interface DayHours {
  dayOfWeek: number;
  open: string;
  close: string;
  enabled: boolean;
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function toHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export default function HoursPage() {
  const { t } = useLanguage();
  const [hours, setHours] = useState<DayHours[]>(
    t.days.map((_, i) => ({ dayOfWeek: i, open: "09:00", close: "18:00", enabled: i !== 6 }))
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch<{ dayOfWeek: number; openMin: number; closeMin: number }[]>("/api/business/hours").then((existing) => {
      if (existing.length === 0) return;
      setHours(
        t.days.map((_, i) => {
          const match = existing.find((h) => h.dayOfWeek === i);
          return match
            ? { dayOfWeek: i, open: toHHMM(match.openMin), close: toHHMM(match.closeMin), enabled: true }
            : { dayOfWeek: i, open: "09:00", close: "18:00", enabled: false };
        })
      );
    });
  }, []);

  async function save() {
    const payload = hours
      .filter((h) => h.enabled)
      .map((h) => ({ dayOfWeek: h.dayOfWeek, openMin: toMin(h.open), closeMin: toMin(h.close) }));
    await apiFetch("/api/business/hours", { method: "PUT", body: JSON.stringify(payload) });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function update(i: number, patch: Partial<DayHours>) {
    setHours((prev) => prev.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{t.hoursTitle}</h1>
        <p className="text-gray-500 text-sm mt-1">{t.hoursSubtitle}</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
        {hours.map((h, i) => (
          <div
            key={h.dayOfWeek}
            className={`flex items-center gap-4 px-5 py-3.5 ${i !== hours.length - 1 ? "border-b border-gray-200/50" : ""} ${!h.enabled ? "opacity-50" : ""}`}
          >
            <input
              type="checkbox"
              checked={h.enabled}
              onChange={(e) => update(i, { enabled: e.target.checked })}
            />
            <span className="w-24 text-sm font-medium text-gray-700">{t.days[h.dayOfWeek]}</span>
            <div className="flex items-center gap-2 ms-auto">
              <input
                type="time"
                value={h.open}
                onChange={(e) => update(i, { open: e.target.value })}
                disabled={!h.enabled}
                className="text-sm py-1.5 px-2"
              />
              <span className="text-gray-400 text-sm">{t.to}</span>
              <input
                type="time"
                value={h.close}
                onChange={(e) => update(i, { close: e.target.value })}
                disabled={!h.enabled}
                className="text-sm py-1.5 px-2"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          className="bg-[#1B7FA0] hover:bg-[#2A9BBF] text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
        >
          {t.saveHours}
        </button>
        {saved && <SavedBadge text={t.saved} />}
      </div>
    </div>
  );
}
