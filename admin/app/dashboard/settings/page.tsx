"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SavedBadge } from "../../lib/SavedBadge";
import { SkeletonCard } from "../../lib/Skeleton";
import { Toggle, Section, Field } from "../../lib/SettingsControls";
import { DIAL_CODES, DEFAULT_DIAL_CODE, dialCodeOf } from "../../lib/dialCodes";

interface BusinessProfile {
  name: string;
  address?: string;
  timezone: string;
  email: string;
  notificationPhone?: string;
  notificationPhoneVerifiedAt?: string | null;
  googleMapsUrl?: string;
  accessibilityContact?: string;
  depositEnabled?: boolean;
  depositAmountIls?: number;
  depositHoldMinutes?: number;
  paymentConnected?: boolean;
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
  aiCostAlert: { he: "התראת עלויות AI", en: "AI cost alert" },
  billingReminder: { he: "תזכורות חיוב", en: "Billing reminders" },
  depositExpiry: { he: "שחרור מקדמות שפגו", en: "Deposit expiry" },
  healthDigest: { he: "דוח בריאות למפעיל", en: "Operator health digest" },
  metricSnapshot: { he: "צילום מדדים", en: "Metric snapshot" },
};

function SystemStatusSection() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [jobs, setJobs] = useState<JobStatus[] | null>(null);
  // The per-job list is operator information: names like aiCostAlert and metricSnapshot mean
  // nothing to a salon owner, and a failure in them is OURS to fix — showing it to the owner
  // hands them a worry they can do nothing about. Owners get one plain sentence; the operator
  // account keeps the full table.
  const [isOperator, setIsOperator] = useState(false);

  useEffect(() => {
    apiFetch<JobStatus[]>("/api/business/system-status").then(setJobs).catch(() => setJobs([]));
    apiFetch<{ isSuperAdmin?: boolean }>("/api/business/me").then((me) => setIsOperator(Boolean(me.isSuperAdmin))).catch(() => {});
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

  if (jobs === null || jobs.length === 0) return null;

  const allOk = jobs.every((j) => j.lastStatus === "ok");

  // The owner's view: one sentence about the things they actually rely on, in their language.
  // No raw job names, no error strings, no table — a failure here is Tori's to fix, and the only
  // thing an owner needs to know is whether their reminders and summaries are going out.
  if (!isOperator) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <div className="flex items-center gap-3">
          <span
            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
              allOk ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-600"
            }`}
            aria-hidden
          >
            {allOk ? (
              <svg className="w-4.5 h-4.5" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            ) : (
              <svg className="w-4.5 h-4.5" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
            )}
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900">
              {allOk
                ? he ? "הכל פועל כרגיל" : "Everything is running normally"
                : he ? "זיהינו תקלה זמנית — אנחנו מטפלים" : "We've spotted a temporary issue — we're on it"}
            </p>
            <p className="text-xs text-gray-600 mt-0.5">
              {allOk
                ? he
                  ? "תזכורות, בקשות ביקורת והסיכום היומי נשלחים בזמן."
                  : "Reminders, review requests and the daily summary are going out on time."
                : he
                  ? "ייתכן עיכוב בתזכורות או בסיכומים. אין צורך לעשות כלום — זה בטיפול שלנו."
                  : "Reminders or summaries may be delayed. Nothing for you to do — it's ours to fix."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // The operator's view: the full table, raw names included — this is the debugging surface.
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-0.5">{he ? "בריאות המערכת" : "System health"}</h2>
      <p className="text-xs text-gray-600 mb-4">
        {he ? "תהליכי הרקע של תורי (מוצג רק לחשבון המפעיל)" : "Tori's background jobs (operator account only)"}
      </p>
      <div className="flex flex-col gap-1.5">
        {jobs.map((j) => {
          const label = JOB_LABELS[j.jobName] ?? { he: j.jobName, en: j.jobName };
          const ok = j.lastStatus === "ok";
          return (
            <div key={j.jobName} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gray-50/60 border border-gray-100">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${ok ? "bg-green-500" : "bg-red-500"}`} />
                <span className="text-sm text-gray-700 font-medium truncate">{he ? label.he : label.en}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!ok && j.lastError && (
                  <span className="text-[11px] text-red-500 max-w-[200px] truncate" title={j.lastError}>{j.lastError}</span>
                )}
                <span className="text-xs text-gray-600 tabular-nums">{relativeTime(j.lastRunAt)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Verification state for the login address, with a resend.
 *
 * Surfaced next to the email rather than buried in a banner because an unverified address fails
 * silently: password resets and every operational notice go to an inbox nobody reads, and the
 * address still *looks* correct in this form. Showing the state where the value lives is the only
 * place an owner would think to check.
 */
function EmailVerificationRow({ email, verified, he }: { email: string; verified: boolean; he: boolean }) {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  if (verified) {
    return (
      <p className="text-xs flex items-center gap-1.5 -mt-1" style={{ color: "#15803D" }}>
        <span aria-hidden>✓</span>
        {he ? "כתובת האימייל מאומתת" : "Email address verified"}
      </p>
    );
  }

  async function resend() {
    setSending(true);
    try {
      await apiFetch("/api/auth/send-verification", { method: "POST", body: JSON.stringify({ email }) });
      setSent(true);
    } catch {
      // The endpoint always reports success (it must not reveal which addresses are registered),
      // so a rejection here is a network/rate-limit problem — showing "sent" anyway would be a lie.
      setSent(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 -mt-1">
      <p className="text-xs text-amber-800 leading-relaxed">
        {he
          ? "כתובת האימייל עדיין לא אומתה. בלי אימות, איפוס סיסמה והודעות חשובות על החשבון עלולים לא להגיע אליך."
          : "This email isn't verified yet. Without it, password resets and important account notices may never reach you."}
      </p>
      {sent ? (
        <p className="text-xs font-medium mt-1.5" style={{ color: "#15803D" }}>
          {he ? "✓ נשלח קישור אימות — בדקו את תיבת הדואר." : "✓ Verification link sent — check your inbox."}
        </p>
      ) : (
        <button
          type="button"
          onClick={resend}
          disabled={sending}
          className="text-xs font-semibold mt-1.5 underline disabled:opacity-50"
          style={{ color: "#B45309" }}
        >
          {sending ? (he ? "שולח…" : "Sending…") : he ? "שליחת קישור אימות" : "Send verification link"}
        </button>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { t, lang } = useLanguage();
  const he = lang === "he";
  const [fields, setFields] = useState<BusinessProfile>({
    name: "", address: "", timezone: "Asia/Jerusalem", email: "",
    notificationPhone: "", googleMapsUrl: "", accessibilityContact: "",
    depositEnabled: false, depositAmountIls: 0, depositHoldMinutes: 30, paymentConnected: false,
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(true); // assume verified until told otherwise, so the warning never flashes on load
  // Reflects the server, not the input box: editing the field does not un-verify anything until
  // the change is actually saved, and re-saving the same number keeps its verification.
  const [savedNotificationPhone, setSavedNotificationPhone] = useState<string | null>(null);
  const [notificationPhoneVerifiedAt, setNotificationPhoneVerifiedAt] = useState<string | null>(null);
  // Derived from the saved number rather than stored separately — the number is already fully
  // qualified, and a second stored copy of the country could only drift out of step with it.
  const [dialCode, setDialCode] = useState(DEFAULT_DIAL_CODE);
  const notificationPhoneVerified =
    Boolean(notificationPhoneVerifiedAt) && fields.notificationPhone?.trim() === (savedNotificationPhone ?? "");

  useEffect(() => {
    apiFetch<BusinessProfile & { emailVerifiedAt?: string | null; notificationPhoneVerifiedAt?: string | null }>("/api/business/me").then((me) => {
      setSavedNotificationPhone(me.notificationPhone ?? "");
      setNotificationPhoneVerifiedAt(me.notificationPhoneVerifiedAt ?? null);
      setDialCode(dialCodeOf(me.notificationPhone));
      setFields({
        name: me.name,
        address: me.address ?? "",
        timezone: me.timezone,
        email: me.email,
        notificationPhone: me.notificationPhone ?? "",
        googleMapsUrl: me.googleMapsUrl ?? "",
        accessibilityContact: me.accessibilityContact ?? "",
        depositEnabled: me.depositEnabled ?? false,
        depositAmountIls: me.depositAmountIls ?? 0,
        depositHoldMinutes: me.depositHoldMinutes ?? 30,
        paymentConnected: me.paymentConnected ?? false,
      });
      setEmailVerified(Boolean(me.emailVerifiedAt));
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
          notificationPhoneDialCode: dialCode,
          googleMapsUrl: fields.googleMapsUrl,
          accessibilityContact: fields.accessibilityContact,
          depositEnabled: fields.depositEnabled,
          depositAmountIls: fields.depositAmountIls,
          depositHoldMinutes: fields.depositHoldMinutes,
        }),
      });
      // Re-read rather than assume: the server normalizes the phone (so what it stored may differ
      // from what was typed) and clears verification when the number changed. Guessing either
      // locally would show a green "verified" against a number that is now unproven.
      const me = await apiFetch<{ notificationPhone?: string | null; notificationPhoneVerifiedAt?: string | null }>(
        "/api/business/me"
      );
      setFields((f) => ({ ...f, notificationPhone: me.notificationPhone ?? "" }));
      setSavedNotificationPhone(me.notificationPhone ?? "");
      setNotificationPhoneVerifiedAt(me.notificationPhoneVerifiedAt ?? null);
      setDialCode(dialCodeOf(me.notificationPhone));

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
        <p className="text-gray-600 text-sm mt-1">{t.settingsSubtitle}</p>
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
            {/* A select, not free text. A typo here ("Asia/Jerusalm") silently shifts every
                reminder and every slot the bot offers, and nothing on screen says why. */}
            <select value={fields.timezone} onChange={(e) => set("timezone", e.target.value)} className="w-full" dir="ltr">
              {[
                "Asia/Jerusalem", "Europe/London", "Europe/Paris", "Europe/Berlin",
                "America/New_York", "America/Los_Angeles",
                // A stored zone outside the list must stay visible while selected — otherwise the
                // browser displays the first option while something else is actually saved.
                ...(["Asia/Jerusalem","Europe/London","Europe/Paris","Europe/Berlin","America/New_York","America/Los_Angeles"].includes(fields.timezone) ? [] : [fields.timezone]),
              ].map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </Field>
          <Field label={t.googleMapsUrl} hint={t.googleMapsUrlHint}>
            <input
              placeholder="https://g.page/r/..."
              value={fields.googleMapsUrl}
              onChange={(e) => set("googleMapsUrl", e.target.value)}
              className="w-full"
            />
          </Field>
          <Field label={t.accessibilityContact} hint={t.accessibilityContactHint}>
            <input
              placeholder={he ? "לדוגמה: אורית · orit@example.com · 03-1234567" : "e.g. Orit · orit@example.com · 03-1234567"}
              value={fields.accessibilityContact}
              onChange={(e) => set("accessibilityContact", e.target.value)}
              className="w-full"
            />
          </Field>
          <Field label={t.loginEmail}>
            <input value={fields.email} disabled className="w-full opacity-60 cursor-not-allowed" />
          </Field>
          <EmailVerificationRow email={fields.email} verified={emailVerified} he={lang === "he"} />
        </Section>

        <Section title={t.bookingNotifications} description={t.bookingNotificationsDesc}>
          {!fields.notificationPhone?.trim() && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-4 py-3 mb-3">
              {lang === "he"
                ? "⚠️ לא הוגדר מספר להתראות — לא תקבלו התראה על תורים חדשים, בקשות לשיחה עם נציג, או בקשות הזמנה. מומלץ מאוד להגדיר."
                : "⚠️ No notification phone set — you won't be alerted about new bookings, human-handoff requests, or booking enquiries. Strongly recommended."}
            </div>
          )}
          <Field label={t.notifPhone} hint={t.notifPhoneHint}>
            {/* The country is chosen, not inferred. Guessing it from the digits meant a bare
                national number was stored with no country code and could never be delivered, and a
                foreign number written with its own trunk zero had 972 forced onto it. */}
            <div className="flex gap-2">
              <select
                value={dialCode}
                onChange={(e) => setDialCode(e.target.value)}
                aria-label={lang === "he" ? "קידומת מדינה" : "Country code"}
                className="w-40 shrink-0"
                dir="ltr"
              >
                {DIAL_CODES.map((c) => (
                  <option key={c.code} value={c.code}>
                    +{c.code} {lang === "he" ? c.he : c.label}
                  </option>
                ))}
              </select>
              <input
                placeholder={dialCode === "972" ? "0501234567" : "501234567"}
                value={fields.notificationPhone}
                onChange={(e) => set("notificationPhone", e.target.value)}
                className="w-full"
                dir="ltr"
              />
            </div>
          </Field>
          {/* A number that was typed is not a number that works, and the difference is invisible
              until the day a customer is promised a callback that never comes. Verified means a
              WhatsApp message to it actually succeeded — either the test button, or any real
              booking alert that has already gone out. */}
          {fields.notificationPhone?.trim() && (
            notificationPhoneVerified ? (
              <p className="flex items-center gap-1.5 text-xs mt-2" style={{ color: "#15803D" }}>
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {he ? "אומת — הודעה למספר הזה נשלחה בהצלחה" : "Verified — a message to this number went through"}
              </p>
            ) : (
              <p className="text-xs mt-2" style={{ color: "#B45309" }}>
                {he
                  ? "עדיין לא אומת. שלחו הודעת בדיקה מעמוד וואטסאפ כדי לוודא שההתראות באמת מגיעות — עד אז אין דרך לדעת שהמספר נכון."
                  : "Not verified yet. Send a test message from the WhatsApp page to confirm alerts actually arrive — until then there's no way to know the number is right."}
              </p>
            )
          )}
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
            <div className="bg-gray-50 border border-gray-200 text-gray-600 text-xs rounded-lg px-3 py-2.5">
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

      <SystemStatusSection />
    </div>
  );
}
