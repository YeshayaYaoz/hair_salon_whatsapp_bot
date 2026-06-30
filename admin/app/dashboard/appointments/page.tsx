"use client";

import { useEffect, useState } from "react";
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

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  useEffect(() => {
    apiFetch<Appointment[]>("/api/business/appointments").then(setAppointments);
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Appointments</h1>
        <p className="text-zinc-400 text-sm mt-1">Upcoming bookings made through WhatsApp</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {appointments.length === 0 ? (
          <div className="px-6 py-12 text-center text-zinc-500 text-sm">No appointments yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-400 font-medium">When</th>
                <th className="text-left px-4 py-3 text-zinc-400 font-medium">Customer</th>
                <th className="text-left px-4 py-3 text-zinc-400 font-medium">Service</th>
                <th className="text-left px-4 py-3 text-zinc-400 font-medium">Staff</th>
                <th className="text-left px-4 py-3 text-zinc-400 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a, i) => (
                <tr key={a.id} className={i !== appointments.length - 1 ? "border-b border-zinc-800/50" : ""}>
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
