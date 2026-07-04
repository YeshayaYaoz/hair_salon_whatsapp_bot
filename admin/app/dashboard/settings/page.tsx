"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SavedBadge } from "../../lib/SavedBadge";

function GoogleCalendarSection() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ connected: boolean }>("/api/business/google-calendar/status")
      .then((r) => setConnected(r.connected))
      .catch(() => setConnected(false));
  }, []);

  // Handle OAuth callback code in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("gcal_code");
    if (!code) return;
    window.history.replaceState({}, "", window.location.pathname);
    apiFetch("/api/business/google-calendar/callback", {
      method: "POST",
      body: JSON.stringify({ code }),
    })
      .then(() => setConnected(true))
      .catch((err) => alert("Google Calendar connection failed: " + err.message));
  }, []);

  async function connect() {
    setLoading(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/business/google-calendar/auth-url");
      window.location.href = url;
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect Google Calendar?")) return;
    await apiFetch("/api/business/google-calendar", { method: "DELETE" });
    setConnected(false);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-0.5 flex items-center gap-2">
            <span className="text-base">📅</span> Google Calendar
          </h2>
          <p className="text-xs text-gray-400">
            {connected
              ? "כל תור שנקבע מסתנכרן אוטומטית לגוגל קלנדר שלך."
              : "חבר את גוגל קלנדר כדי שתורים יופיעו שם אוטומטית."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {connected === null ? (
            <span className="text-xs text-zinc-600">טוען...</span>
          ) : connected ? (
            <>
              <span className="flex items-center gap-1.5 text-xs text-green-700 font-medium">
                <span className="w-2 h-2 rounded-full bg-green-400 inline-block"></span>
                מחובר
              </span>
              <button
                onClick={disconnect}
                className="text-xs text-gray-400 hover:text-red-600 transition border border-gray-200 hover:border-red-200 px-3 py-1.5 rounded-lg"
              >
                נתק
              </button>
            </>
          ) : (
            <button
              onClick={connect}
              disabled={loading}
              className="flex items-center gap-2 bg-white hover:bg-zinc-100 text-zinc-900 text-xs font-semibold px-3 py-2 rounded-lg transition disabled:opacity-50"
            >
              <svg width="14" height="14" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              {loading ? "מחבר..." : "חבר Google Calendar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface BusinessProfile {
  name: string;
  address?: string;
  timezone: string;
  email: string;
  notificationPhone?: string;
  botGreeting?: string;
  botPersonality?: string;
  googleMapsUrl?: string;
  remindersEnabled?: boolean;
  reviewsEnabled?: boolean;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 transition-colors ${checked ? "bg-violet-600 border-violet-600" : "bg-gray-200 border-gray-200"}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-0.5">{title}</h2>
      {description && <p className="text-xs text-gray-400 mb-4">{description}</p>}
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-zinc-600 mt-1">{hint}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useLanguage();
  const [fields, setFields] = useState<BusinessProfile>({
    name: "", address: "", timezone: "Asia/Jerusalem", email: "",
    notificationPhone: "", botGreeting: "", botPersonality: "", googleMapsUrl: "",
    remindersEnabled: true, reviewsEnabled: true,
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
        googleMapsUrl: me.googleMapsUrl ?? "",
        remindersEnabled: me.remindersEnabled ?? true,
        reviewsEnabled: me.reviewsEnabled ?? true,
      });
      setLoaded(true);
    });
  }, []);

  function set(key: keyof BusinessProfile, value: string | boolean) {
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
          googleMapsUrl: fields.googleMapsUrl,
          remindersEnabled: fields.remindersEnabled,
          reviewsEnabled: fields.reviewsEnabled,
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
        <h1 className="text-2xl font-bold text-gray-900 mb-6">{t.settingsTitle}</h1>
        <p className="text-gray-400 text-sm">{t.loading}</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{t.settingsTitle}</h1>
        <p className="text-gray-500 text-sm mt-1">{t.settingsSubtitle}</p>
      </div>

      <GoogleCalendarSection />

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
          <Field label={t.googleMapsUrl} hint={t.googleMapsUrlHint}>
            <input
              placeholder="https://g.page/r/..."
              value={fields.googleMapsUrl}
              onChange={(e) => set("googleMapsUrl", e.target.value)}
              className="w-full"
            />
          </Field>
        </Section>

        <Section title={t.automatedMessages} description={t.automatedMessagesDesc}>
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2.5">
            {t.templateWarning}
          </div>
          <label className="flex items-center justify-between gap-3">
            <span className="text-xs text-gray-700">{t.remindersLabel}</span>
            <Toggle checked={fields.remindersEnabled ?? true} onChange={(v) => set("remindersEnabled", v)} />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-xs text-gray-700">{t.reviewsLabel}</span>
            <Toggle checked={fields.reviewsEnabled ?? true} onChange={(v) => set("reviewsEnabled", v)} />
          </label>
        </Section>

        <Section title={t.botPersonalityTitle} description={t.botPersonalityDesc}>
          <Field label={t.greeting}>
            <textarea
              rows={2}
              placeholder={t.greetingPlaceholder}
              value={fields.botGreeting}
              onChange={(e) => set("botGreeting", e.target.value)}
              className="w-full"
            />
          </Field>
          <Field label={t.personality}>
            <textarea
              rows={3}
              placeholder={t.personalityPlaceholder}
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
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-gray-900 text-sm font-semibold px-5 py-2.5 rounded-lg transition"
          >
            {saving ? t.saving : t.save}
          </button>
          {saved && <SavedBadge text={t.saved} />}
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
      </form>
    </div>
  );
}
