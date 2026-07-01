"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SavedBadge } from "../../lib/SavedBadge";

export default function WhatsAppPage() {
  const { t } = useLanguage();
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
    <div className="max-w-lg animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-white">{t.whatsappTitle}</h1>
        <p className="text-zinc-400 text-sm mt-1">{t.whatsappSubtitle}</p>
      </div>

      <div className="flex items-center gap-2 mb-6">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${connected ? "bg-green-950/50 text-green-400 border border-green-800" : "bg-zinc-800 text-zinc-400 border border-zinc-700"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-400" : "bg-zinc-500"}`} />
          {connected ? t.connected : t.notConnected}
        </span>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-4">
        <form onSubmit={save} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">{t.phoneNumberId}</label>
            <input
              placeholder={t.phoneNumberIdPlaceholder}
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              required
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">{t.accessToken}</label>
            <input
              placeholder={t.accessTokenPlaceholder}
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
              {saving ? t.saving : t.save}
            </button>
            {saved && <SavedBadge text={t.saved} />}
          </div>
        </form>
      </div>

      <p className="text-xs text-zinc-500">{t.whatsappHint}</p>
    </div>
  );
}
