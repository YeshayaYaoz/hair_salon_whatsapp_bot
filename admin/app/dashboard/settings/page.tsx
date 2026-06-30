"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SavedBadge } from "../../lib/SavedBadge";

interface BusinessProfile {
  name: string;
  address?: string;
  timezone: string;
  email: string;
  notificationPhone?: string;
  botGreeting?: string;
  botPersonality?: string;
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-4">
      <h2 className="text-sm font-semibold text-white mb-0.5">{title}</h2>
      {description && <p className="text-xs text-zinc-500 mb-4">{description}</p>}
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-zinc-600 mt-1">{hint}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useLanguage();
  const [fields, setFields] = useState<BusinessProfile>({
    name: "", address: "", timezone: "Asia/Jerusalem", email: "",
    notificationPhone: "", botGreeting: "", botPersonality: "",
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<BusinessProfile>("/api/business/me").then((me) => {
      setFields({
        name: me.name,
        address: me.address ?? "",
        timezone: me.timezone,
        email: me.email,
        notificationPhone: me.notificationPhone ?? "",
        botGreeting: me.botGreeting ?? "",
        botPersonality: me.botPersonality ?? "",
      });
      setLoaded(true);
    });
  }, []);

  function set(key: keyof BusinessProfile, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/business/me", {
        method: "PUT",
        body: JSON.stringify({
          name: fields.name,
          address: fields.address,
          timezone: fields.timezone,
          notificationPhone: fields.notificationPhone,
          botGreeting: fields.botGreeting,
          botPersonality: fields.botPersonality,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white mb-6">{t.settingsTitle}</h1>
        <p className="text-zinc-500 text-sm">{t.loading}</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-white">{t.settingsTitle}</h1>
        <p className="text-zinc-400 text-sm mt-1">{t.settingsSubtitle}</p>
      </div>

      <form onSubmit={save}>
        <Section title={t.businessProfile} description={t.businessProfileDesc}>
          <Field label={t.salonName}>
            <input value={fields.name} onChange={(e) => set("name", e.target.value)} required className="w-full" />
          </Field>
          <Field label={t.address}>
            <input value={fields.address} onChange={(e) => set("address", e.target.value)} className="w-full" />
          </Field>
          <Field label={t.timezone}>
            <input value={fields.timezone} onChange={(e) => set("timezone", e.target.value)} className="w-full" />
          </Field>
          <Field label={t.loginEmail}>
            <input value={fields.email} disabled className="w-full opacity-60 cursor-not-allowed" />
          </Field>
        </Section>

        <Section title={t.bookingNotifications} description={t.bookingNotificationsDesc}>
          <Field label={t.notifPhone} hint={t.notifPhoneHint}>
            <input
              placeholder="972501234567"
              value={fields.notificationPhone}
              onChange={(e) => set("notificationPhone", e.target.value)}
              className="w-full"
            />
          </Field>
        </Section>

        <Section title={t.botPersonalityTitle} description={t.botPersonalityDesc}>
          <Field label={t.greeting}>
            <textarea
              rows={2}
              placeholder="e.g. שלום! ברוכים הבאים לסלון שיר 💇‍♀️ במה אוכל לעזור?"
              value={fields.botGreeting}
              onChange={(e) => set("botGreeting", e.target.value)}
              className="w-full"
            />
          </Field>
          <Field label={t.personality}>
            <textarea
              rows={3}
              placeholder="e.g. Be friendly and use emojis occasionally. Always respond in Hebrew."
              value={fields.botPersonality}
              onChange={(e) => set("botPersonality", e.target.value)}
              className="w-full"
            />
          </Field>
        </Section>

        <div className="flex items-center gap-3 mt-2">
          <button
            type="submit"
            disabled={saving}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
          >
            {saving ? t.saving : t.save}
          </button>
          {saved && <SavedBadge text={t.saved} />}
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
      </form>
    </div>
  );
}
