"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface DayHours {
  dayOfWeek: number;
  open: string; // "HH:MM"
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
  const [hours, setHours] = useState<DayHours[]>(
    DAYS.map((_, i) => ({ dayOfWeek: i, open: "09:00", close: "18:00", enabled: i !== 6 }))
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch<{ dayOfWeek: number; openMin: number; closeMin: number }[]>("/api/business/hours").then((existing) => {
      if (existing.length === 0) return;
      setHours(
        DAYS.map((_, i) => {
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
    <main>
      <h2>Opening Hours</h2>
      {hours.map((h, i) => (
        <div key={h.dayOfWeek} style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <input type="checkbox" checked={h.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
          <span style={{ width: 100 }}>{DAYS[h.dayOfWeek]}</span>
          <input type="time" value={h.open} onChange={(e) => update(i, { open: e.target.value })} disabled={!h.enabled} />
          <span>to</span>
          <input type="time" value={h.close} onChange={(e) => update(i, { close: e.target.value })} disabled={!h.enabled} />
        </div>
      ))}
      <button onClick={save}>Save hours</button>
      {saved && <span style={{ marginLeft: 8, color: "green" }}>Saved</span>}
    </main>
  );
}
