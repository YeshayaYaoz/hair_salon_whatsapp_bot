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
  const [adding, setAdding] = useState(false);

  async function load() {
    setServices(await apiFetch<Service[]>("/api/business/services"));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function addService(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
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
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    await apiFetch(`/api/business/services/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Services</h1>
        <p className="text-zinc-400 text-sm mt-1">Manage the services your salon offers</p>
      </div>

      {/* Services table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-6">
        {services.length === 0 ? (
          <div className="px-6 py-10 text-center text-zinc-500 text-sm">No services yet. Add one below.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-400 font-medium">Name</th>
                <th className="text-left px-4 py-3 text-zinc-400 font-medium">Price</th>
                <th className="text-left px-4 py-3 text-zinc-400 font-medium">Duration</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {services.map((s, i) => (
                <tr key={s.id} className={i !== services.length - 1 ? "border-b border-zinc-800/50" : ""}>
                  <td className="px-4 py-3 text-zinc-100 font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-zinc-300">₪{(s.priceCents / 100).toFixed(0)}</td>
                  <td className="px-4 py-3 text-zinc-300">{s.durationMin} min</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(s.id)}
                      className="text-xs text-zinc-500 hover:text-red-400 transition px-2 py-1 rounded hover:bg-red-950/30"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add form */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4">Add a service</h2>
        <form onSubmit={addService} className="flex gap-3 flex-wrap">
          <input
            placeholder="Service name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="flex-1 min-w-32"
          />
          <input
            placeholder="Price (₪)"
            type="number"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
            className="w-28"
          />
          <input
            placeholder="Duration (min)"
            type="number"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            required
            className="w-32"
          />
          <button
            type="submit"
            disabled={adding}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            {adding ? "Adding..." : "Add"}
          </button>
        </form>
        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
      </div>
    </div>
  );
}
