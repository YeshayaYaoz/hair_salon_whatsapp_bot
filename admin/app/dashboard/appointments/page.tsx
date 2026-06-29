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

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  useEffect(() => {
    apiFetch<Appointment[]>("/api/business/appointments").then(setAppointments);
  }, []);

  return (
    <main>
      <h2>Appointments</h2>
      <table style={{ width: "100%" }}>
        <thead>
          <tr>
            <th align="left">When</th>
            <th align="left">Customer</th>
            <th align="left">Service</th>
            <th align="left">Staff</th>
            <th align="left">Status</th>
          </tr>
        </thead>
        <tbody>
          {appointments.map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.startTime).toLocaleString()}</td>
              <td>{a.customer.name ?? a.customer.phone}</td>
              <td>{a.service.name}</td>
              <td>{a.staff?.name ?? "-"}</td>
              <td>{a.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
