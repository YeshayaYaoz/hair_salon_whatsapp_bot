"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

interface Service {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  durationMin: number;
}

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setServices(await apiFetch<Service[]>("/api/business/services"));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function addService(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/business/services", {
        method: "POST",
        body: JSON.stringify({
          name,
          priceCents: Math.round(Number(price) * 100),
          durationMin: Number(duration),
        }),
      });
      setName("");
      setPrice("");
      setDuration("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add service");
    }
  }

  async function remove(id: string) {
    await apiFetch(`/api/business/services/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <main>
      <h2>Services</h2>
      <table style={{ width: "100%", marginBottom: 16 }}>
        <thead>
          <tr>
            <th align="left">Name</th>
            <th align="left">Price</th>
            <th align="left">Duration</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {services.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{(s.priceCents / 100).toFixed(2)}</td>
              <td>{s.durationMin} min</td>
              <td>
                <button onClick={() => remove(s.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Add a service</h3>
      <form onSubmit={addService} style={{ display: "flex", gap: 8 }}>
        <input placeholder="Name (e.g. Haircut)" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="Price" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
        <input
          placeholder="Duration (min)"
          type="number"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          required
        />
        <button type="submit">Add</button>
      </form>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </main>
  );
}
