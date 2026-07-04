"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";

const COLORS = [
  { hex: "#2A9BBF", name: "violet" },
  { hex: "#f43f5e", name: "rose" },
  { hex: "#f59e0b", name: "amber" },
  { hex: "#10b981", name: "emerald" },
  { hex: "#0ea5e9", name: "sky" },
  { hex: "#f97316", name: "orange" },
];

interface Service {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  durationMin: number;
  color?: string;
}

interface EditState {
  name: string;
  description: string;
  price: string;
  duration: string;
  color: string;
}

export default function ServicesPage() {
  const { t } = useLanguage();
  const [services, setServices] = useState<Service[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ name: "", description: "", price: "", duration: "", color: COLORS[0].hex });
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newDuration, setNewDuration] = useState("");
  const [newColor, setNewColor] = useState(COLORS[0].hex);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setServices(await apiFetch<Service[]>("/api/business/services"));
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  function startEdit(s: Service) {
    setEditingId(s.id);
    setEditState({
      name: s.name,
      description: s.description ?? "",
      price: (s.priceCents / 100).toFixed(0),
      duration: String(s.durationMin),
      color: s.color ?? COLORS[0].hex,
    });
  }

  async function saveEdit(id: string) {
    setSaving(true);
    try {
      await apiFetch(`/api/business/services/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: editState.name,
          description: editState.description || undefined,
          priceCents: Math.round(Number(editState.price) * 100),
          durationMin: Number(editState.duration),
          color: editState.color,
        }),
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function addService(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      await apiFetch("/api/business/services", {
        method: "POST",
        body: JSON.stringify({
          name: newName,
          description: newDescription || undefined,
          priceCents: Math.round(Number(newPrice) * 100),
          durationMin: Number(newDuration),
          color: newColor,
        }),
      });
      setNewName(""); setNewDescription(""); setNewPrice(""); setNewDuration(""); setNewColor(COLORS[0].hex);
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

  function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
    return (
      <div className="flex gap-1.5">
        {COLORS.map((c) => (
          <button
            key={c.hex}
            type="button"
            onClick={() => onChange(c.hex)}
            className={`w-5 h-5 rounded-full transition ring-offset-zinc-900 ${value === c.hex ? "ring-2 ring-white ring-offset-2" : "opacity-60 hover:opacity-100"}`}
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{t.servicesTitle}</h1>
        <p className="text-gray-500 text-sm mt-1">
          {services.length === 0 ? t.servicesSubtitle : `${services.length} ${t.nav.services}`}
        </p>
      </div>

      {/* Services list */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6 animate-fade-up stagger-2">
        {services.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm">{t.noServices}</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/50">
            {services.map((s) =>
              editingId === s.id ? (
                <div key={s.id} className="px-4 py-4 bg-gray-100/30">
                  <div className="flex flex-wrap gap-2 mb-2">
                    <input value={editState.name} onChange={(e) => setEditState((p) => ({ ...p, name: e.target.value }))} placeholder={t.serviceName} className="flex-1 min-w-32 text-sm" />
                    <input value={editState.price} onChange={(e) => setEditState((p) => ({ ...p, price: e.target.value }))} placeholder={t.price} type="number" className="w-24 text-sm" />
                    <input value={editState.duration} onChange={(e) => setEditState((p) => ({ ...p, duration: e.target.value }))} placeholder={t.duration} type="number" className="w-28 text-sm" />
                  </div>
                  <input value={editState.description} onChange={(e) => setEditState((p) => ({ ...p, description: e.target.value }))} placeholder={t.descriptionOptional} className="w-full text-sm mb-2" />
                  <div className="flex items-center justify-between">
                    <ColorPicker value={editState.color} onChange={(hex) => setEditState((p) => ({ ...p, color: hex }))} />
                    <div className="flex gap-2">
                      <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1.5 rounded-lg transition">{t.cancel}</button>
                      <button onClick={() => saveEdit(s.id)} disabled={saving} className="text-xs bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white font-semibold px-3 py-1.5 rounded-lg transition">{saving ? t.saving : t.save}</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color ?? "#2A9BBF" }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-800 font-medium text-sm">{s.name}</div>
                    {s.description && <div className="text-gray-400 text-xs truncate">{s.description}</div>}
                  </div>
                  <div className="text-gray-500 text-sm shrink-0">₪{(s.priceCents / 100).toFixed(0)}</div>
                  <div className="text-gray-400 text-xs shrink-0">{s.durationMin}m</div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => startEdit(s)} className="text-xs text-gray-400 hover:text-[#1B7FA0] transition px-2 py-1 rounded hover:bg-[#E0F5FB]">{t.edit}</button>
                    <button onClick={() => remove(s.id)} className="text-xs text-gray-400 hover:text-red-600 transition px-2 py-1 rounded hover:bg-red-950/30">{t.delete}</button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Add form */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 animate-fade-up stagger-3">
        <h2 className="text-sm font-semibold text-gray-600 mb-4">{t.addService}</h2>
        <form onSubmit={addService} className="flex flex-col gap-2">
          <div className="flex gap-2 flex-wrap">
            <input placeholder={t.serviceName} value={newName} onChange={(e) => setNewName(e.target.value)} required className="flex-1 min-w-32" />
            <input placeholder={t.price} type="number" step="1" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} required className="w-28" />
            <input placeholder={t.duration} type="number" value={newDuration} onChange={(e) => setNewDuration(e.target.value)} required className="w-32" />
          </div>
          <input placeholder={t.descriptionOptional} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} className="w-full" />
          <div className="flex items-center justify-between mt-1">
            <ColorPicker value={newColor} onChange={setNewColor} />
            <button type="submit" disabled={adding} className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
              {adding ? "…" : t.add}
            </button>
          </div>
        </form>
        {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
      </div>
    </div>
  );
}
