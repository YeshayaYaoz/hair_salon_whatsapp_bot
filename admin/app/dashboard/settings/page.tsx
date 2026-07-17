"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SavedBadge } from "../../lib/SavedBadge";
import { SkeletonCard } from "../../lib/Skeleton";

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
  cancellationPolicy?: string;
  referralText?: string;
  digestEnabled?: boolean;
  depositEnabled?: boolean;
  depositAmountIls?: number;
  depositHoldMinutes?: number;
  paymentConnected?: boolean;
  voicePhoneNumber?: string | null;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      dir="ltr"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 transition-colors ${checked ? "bg-[#1B7FA0] border-[#1B7FA0]" : "bg-gray-200 border-gray-200"}`}
    >
      <span
        className="absolute top-0 left-0 h-4 w-4 rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? "translateX(1rem)" : "translateX(0)" }}
      />
    </button>
  );
}

interface JobStatus {
  jobName: string;
  lastRunAt: string;
  lastStatus: string;
  lastError: string | null;
  lastDurationMs: number | null;
}

const JOB_LABELS: Record<string, { he: string; en: string }> = {
  reminders: { he: "תזכורות תורים", en: "Appointment reminders" },
  reviews: { he: "בקשות ביקורת", en: "Review requests" },
  digest: { he: "סיכום יומי", en: "Daily digest" },
  retention: { he: "ניקוי נתונים", en: "Data retention cleanup" },
};

function SystemStatusSection() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [jobs, setJobs] = useState<JobStatus[] | null>(null);

  useEffect(() => {
    apiFetch<JobStatus[]>("/api/business/system-status").then(setJobs).catch(() => setJobs([]));
  }, []);

  function relativeTime(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60_000);
    if (mins < 1) return he ? "עכשיו" : "just now";
    if (mins < 60) return he ? `לפני ${mins} דק׳` : `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return he ? `לפני ${hours} שעות` : `${hours}h ago`;
    const days = Math.round(hours / 24);
    return he ? `לפני ${days} ימים` : `${days}d ago`;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-0.5">{he ? "בריאות המערכת" : "System health"}</h2>
      <p className="text-xs text-gray-400 mb-4">
        {he ? "מעקב אחרי תהליכים אוטומטיים שרצים ברקע" : "Status of automated jobs running in the background"}
      </p>
      {jobs === null ? (
        <SkeletonCard lines={4} />
      ) : jobs.length === 0 ? (
        <p className="text-xs text-gray-400">{he ? "עדיין אין נתונים — הריצה הראשונה עוד לא הושלמה" : "No data yet — jobs haven't completed a first run"}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {jobs.map((j) => {
            const label = JOB_LABELS[j.jobName] ?? { he: j.jobName, en: j.jobName };
            const ok = j.lastStatus === "ok";
            return (
              <div key={j.jobName} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-gray-50/60 border border-gray-100">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${ok ? "bg-green-500" : "bg-red-500"}`} />
                  <span className="text-sm text-gray-700 font-medium truncate">{he ? label.he : label.en}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!ok && j.lastError && (
                    <span className="text-[11px] text-red-500 max-w-[200px] truncate" title={j.lastError}>{j.lastError}</span>
                  )}
                  <span className="text-xs text-gray-400 tabular-nums">{relativeTime(j.lastRunAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VoicePhoneSection() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [current, setCurrent] = useState<string | null | undefined>(undefined); // undefined = loading
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ voicePhoneNumber?: string | null }>("/api/business/me").then((me) => {
      setCurrent(me.voicePhoneNumber ?? null);
      setValue(me.voicePhoneNumber ?? "");
    });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/business/me/voice-phone", { method: "PUT", body: JSON.stringify({ voicePhoneNumber: value }) });
      setCurrent(value);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : he ? "השמירה נכשלה" : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/business/me/voice-phone", { method: "DELETE" });
      setCurrent(null);
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : he ? "הניתוק נכשל" : "Failed to disconnect");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
      <div className="flex items-center gap-2 mb-0.5">
        <h2 className="text-sm font-semibold text-gray-900">{he ? "בוט טלפוני (שיחות קוליות)" : "Voice bot (phone calls)"}</h2>
        {current === null ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
            {he ? "לא מחובר" : "Not connected"}
          </span>
        ) : current ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
            {he ? "מחובר" : "Connected"}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-gray-400 mb-4">
        {he
          ? "מספר הטלפון שסופק ע\"י Cartesia עבור העסק שלך — שיחות נכנסות למספר הזה ייענו ע\"י הבוט הקולי."
          : "The phone number Cartesia provisioned for your business — incoming calls to this number are answered by the voice bot."}
      </p>
      {current === undefined ? (
        <SkeletonCard lines={1} />
      ) : (
        <form onSubmit={save} className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 mb-1.5">{he ? "מספר טלפון" : "Phone number"}</label>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="+972501234567"
              dir="ltr"
              className="w-full"
            />
          </div>
          <button
            type="submit"
            disabled={saving || !value}
            className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            {saving ? (he ? "שומר..." : "Saving...") : he ? "שמור" : "Save"}
          </button>
          {current && (
            <button
              type="button"
              onClick={disconnect}
              disabled={saving}
              className="text-xs text-red-500 hover:text-red-600 disabled:opacity-50 transition px-2 py-2"
            >
              {he ? "נתק" : "Disconnect"}
            </button>
          )}
          {saved && <SavedBadge text={he ? "נשמר" : "Saved"} />}
        </form>
      )}
      {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
    </div>
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
  const { t, lang } = useLanguage();
  const he = lang === "he";
  const [fields, setFields] = useState<BusinessProfile>({
    name: "", address: "", timezone: "Asia/Jerusalem", email: "",
    notificationPhone: "", botGreeting: "", botPersonality: "", googleMapsUrl: "",
    remindersEnabled: true, reviewsEnabled: true,
    cancellationPolicy: "", referralText: "", digestEnabled: true,
    depositEnabled: false, depositAmountIls: 0, depositHoldMinutes: 30, paymentConnected: false,
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
        cancellationPolicy: me.cancellationPolicy ?? "",
        referralText: me.referralText ?? "",
        digestEnabled: me.digestEnabled ?? true,
        depositEnabled: me.depositEnabled ?? false,
        depositAmountIls: me.depositAmountIls ?? 0,
        depositHoldMinutes: me.depositHoldMinutes ?? 30,
        paymentConnected: me.paymentConnected ?? false,
      });
      setLoaded(true);
    });
  }, []);

  function set(key: keyof BusinessProfile, value: string | boolean | number) {
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
          cancellationPolicy: fields.cancellationPolicy,
          referralText: fields.referralText,
          digestEnabled: fields.digestEnabled,
          depositEnabled: fields.depositEnabled,
          depositAmountIls: fields.depositAmountIls,
          depositHoldMinutes: fields.depositHoldMinutes,
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
      <div className="animate-fade-in">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">{t.settingsTitle}</h1>
        <div className="flex flex-col gap-4">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={3} />
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{t.settingsTitle}</h1>
        <p className="text-gray-500 text-sm mt-1">{t.settingsSubtitle}</p>
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
          <label className="flex items-center justify-between gap-3">
            <span className="text-xs text-gray-700">{he ? "סיכום יומי בבוקר (וואטסאפ)" : "Morning daily digest (WhatsApp)"}</span>
            <Toggle checked={fields.digestEnabled ?? true} onChange={(v) => set("digestEnabled", v)} />
          </label>
        </Section>

        <Section
          title={he ? "מקדמה לפני תור" : "Deposit before booking"}
          description={
            he
              ? "כשמופעל, הבוט שולח ללקוח קישור תשלום למקדמה במקום לאשר תור מיידית — התור מאושר סופית רק אחרי שהתשלום מתקבל."
              : "When enabled, the bot sends a deposit payment link instead of confirming instantly — the booking is only finalized once the deposit is paid."
          }
        >
          {!fields.paymentConnected ? (
            <div className="bg-gray-50 border border-gray-200 text-gray-500 text-xs rounded-lg px-3 py-2.5">
              {he
                ? "יש לחבר קודם ספק סליקה בעמוד סליקה וחשבוניות כדי להפעיל מקדמות."
                : "Connect a payment provider on the Payments page first to enable deposits."}
            </div>
          ) : (
            <>
              <label className="flex items-center justify-between gap-3">
                <span className="text-xs text-gray-700">{he ? "דרוש מקדמה לכל תור" : "Require a deposit for every booking"}</span>
                <Toggle checked={fields.depositEnabled ?? false} onChange={(v) => set("depositEnabled", v)} />
              </label>
              {fields.depositEnabled && (
                <>
                  <Field label={he ? "סכום המקדמה (₪)" : "Deposit amount (₪)"}>
                    <input
                      type="number"
                      min={1}
                      value={fields.depositAmountIls || ""}
                      onChange={(e) => set("depositAmountIls", Number(e.target.value) || 0)}
                      placeholder="50"
                      className="w-32"
                    />
                  </Field>
                  <Field
                    label={he ? "זמן להחזקת המועד (דקות)" : "Hold time before releasing the slot (minutes)"}
                    hint={he ? "אם הלקוח לא ישלם תוך זמן זה, המועד ישוחרר ללקוח אחר" : "If unpaid within this window, the slot is released back to other customers"}
                  >
                    <input
                      type="number"
                      min={5}
                      value={fields.depositHoldMinutes || ""}
                      onChange={(e) => set("depositHoldMinutes", Number(e.target.value) || 0)}
                      placeholder="30"
                      className="w-32"
                    />
                  </Field>
                </>
              )}
            </>
          )}
        </Section>

        <Section
          title={he ? "מדיניות ותמריצים" : "Policy & incentives"}
          description={he ? "טקסטים שהבוט משתמש בהם בשיחות עם לקוחות" : "Text the bot uses in customer conversations"}
        >
          <Field
            label={he ? "מדיניות ביטולים" : "Cancellation policy"}
            hint={he ? "הבוט יזכיר את זה כשלקוח מבטל תור" : "The bot mentions this when a customer cancels"}
          >
            <textarea
              rows={2}
              placeholder={he ? "לדוגמה: ביטול עד 24 שעות מראש ללא עלות." : "e.g. Free cancellation up to 24h in advance."}
              value={fields.cancellationPolicy}
              onChange={(e) => set("cancellationPolicy", e.target.value)}
              className="w-full"
            />
          </Field>
          <Field
            label={he ? "הצעת חבר מביא חבר" : "Referral offer"}
            hint={he ? "נוסף להודעת הביקורת אחרי הביקור" : "Appended to the post-visit review message"}
          >
            <input
              placeholder={he ? "לדוגמה: הזמן חבר וקבל 10% הנחה בביקור הבא!" : "e.g. Refer a friend and get 10% off your next visit!"}
              value={fields.referralText}
              onChange={(e) => set("referralText", e.target.value)}
              className="w-full"
            />
          </Field>
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
            className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
          >
            {saving ? t.saving : t.save}
          </button>
          {saved && <SavedBadge text={t.saved} />}
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
      </form>

      <VoicePhoneSection />
      <SystemStatusSection />
    </div>
  );
}
