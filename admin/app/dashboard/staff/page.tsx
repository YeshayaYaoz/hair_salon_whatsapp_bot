"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";

interface Staff {
  id: string;
  name: string;
}

export default function StaffPage() {
  const { t } = useLanguage();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function load() {
    setStaff(await apiFetch<Staff[]>("/api/business/staff"));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function addStaff(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      await apiFetch("/api/business/staff", { method: "POST", body: JSON.stringify({ name }) });
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add staff member");
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    await apiFetch(`/api/business/staff/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{t.staffTitle}</h1>
        <p className="text-gray-500 text-sm mt-1">{t.staffSubtitle}</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6 animate-fade-up stagger-2">
        {staff.length === 0 ? (
          <div className="px-6 py-10 text-center text-gray-400 text-sm">{t.noStaff}</div>
        ) : (
          <ul>
            {staff.map((s, i) => (
              <li
                key={s.id}
                className={`flex items-center justify-between px-4 py-3 ${i !== staff.length - 1 ? "border-b border-gray-200/50" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#1B7FA0]/20 text-[#5BB8D4] flex items-center justify-center text-xs font-semibold">
                    {s.name.slice(0, 1).toUpperCase()}
                  </div>
                  <span className="text-gray-800 font-medium text-sm">{s.name}</span>
                </div>
                <button
                  onClick={() => remove(s.id)}
                  className="text-xs text-gray-400 hover:text-red-600 transition px-2 py-1 rounded hover:bg-red-950/30"
                >
                  {t.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 animate-fade-up stagger-3">
        <h2 className="text-sm font-semibold text-gray-600 mb-4">{t.addStaffMember}</h2>
        <form onSubmit={addStaff} className="flex gap-3">
          <input
            placeholder={t.staffName}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="flex-1"
          />
          <button
            type="submit"
            disabled={adding}
            className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            {adding ? "…" : t.add}
          </button>
        </form>
        {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
      </div>
    </div>
  );
}
