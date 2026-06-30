"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

interface BusinessProfile {
  name: string;
  address?: string;
  timezone: string;
  email: string;
}

export default function SettingsPage() {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("Asia/Jerusalem");
  const [email, setEmail] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<BusinessProfile>("/api/business/me").then((me) => {
      setName(me.name);
      setAddress(me.address ?? "");
      setTimezone(me.timezone);
      setEmail(me.email);
      setLoaded(true);
    });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/business/me", { method: "PUT", body: JSON.stringify({ name, address, timezone }) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-zinc-400 text-sm mt-1">Your salon's business profile, shown to customers via the bot</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        {!loaded ? (
          <p className="text-zinc-500 text-sm">Loading...</p>
        ) : (
          <form onSubmit={save} className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Salon name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Address</label>
              <input
                placeholder="e.g. Rothschild 12, Tel Aviv"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Timezone</label>
              <input value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Login email</label>
              <input value={email} disabled className="w-full opacity-60 cursor-not-allowed" />
            </div>

            <div className="flex items-center gap-3 mt-2">
              <button
                type="submit"
                disabled={saving}
                className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
              {saved && (
                <span className="text-green-400 text-sm flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Saved
                </span>
              )}
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
