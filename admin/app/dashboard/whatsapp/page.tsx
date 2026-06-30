"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

export default function WhatsAppPage() {
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ whatsappConnected: boolean }>("/api/business/me").then((me) => setConnected(me.whatsappConnected));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await apiFetch("/api/business/me/whatsapp", { method: "PUT", body: JSON.stringify({ phoneNumberId, accessToken }) });
    setSaved(true);
    setConnected(true);
    setSaving(false);
  }

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">WhatsApp Connection</h1>
        <p className="text-zinc-400 text-sm mt-1">Connect your Meta WhatsApp Business number</p>
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-2 mb-6">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${connected ? "bg-green-950/50 text-green-400 border border-green-800" : "bg-zinc-800 text-zinc-400 border border-zinc-700"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-400" : "bg-zinc-500"}`} />
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-4">
        <form onSubmit={save} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Phone Number ID</label>
            <input
              placeholder="e.g. 123456789012345"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              required
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Access Token</label>
            <input
              placeholder="Permanent access token from Meta"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              required
              className="w-full"
            />
          </div>
          <div className="flex items-center gap-3 mt-1">
            <button
              type="submit"
              disabled={saving}
              className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
            >
              {saving ? "Saving..." : "Save"}
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
        </form>
      </div>

      <p className="text-xs text-zinc-500">
        Find these in your Meta Business app under <span className="text-zinc-400">WhatsApp › API Setup</span>. Use a permanent token, not a temporary one.
      </p>
    </div>
  );
}
