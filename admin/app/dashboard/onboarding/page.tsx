"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SkeletonCard } from "../../lib/Skeleton";
import { DIAL_CODES, DEFAULT_DIAL_CODE } from "../../lib/dialCodes";
import { reloadAs } from "../../lib/api";

interface TemplateCard {
  type: string;
  emoji: string;
  labelHe: string;
  labelEn: string;
  descriptionHe: string;
  descriptionEn: string;
  depositEnabled: boolean;
  depositAmountIls: number;
  reviewsEnabled: boolean;
  sampleServices: string[];
}

export default function OnboardingPage() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateCard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Which step this visit is for. The manager number comes first and cannot be skipped: it is
   * the number every owner alert goes to and the one the manager tools trust, and an account with
   * a bot but no owner behind it is the state most of the early accounts were stuck in. Accounts
   * created through Google land here because Google's form never asked; older accounts land here
   * because the number was optional when they signed up. Once it is saved the category step
   * follows if it is still missing, otherwise straight to the dashboard.
   */
  const [phase, setPhase] = useState<"loading" | "phone" | "category">("loading");
  const [phone, setPhone] = useState("");
  const [dialCode, setDialCode] = useState(DEFAULT_DIAL_CODE);
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ notificationPhone?: string | null; businessTypeChosenAt?: string | null; isSuperAdmin?: boolean }>("/api/business/me")
      .then((me) => {
        const hasPhone = Boolean(me.notificationPhone?.trim()) || Boolean(me.isSuperAdmin);
        if (!hasPhone) setPhase("phone");
        else if (!me.businessTypeChosenAt) setPhase("category");
        else router.replace("/dashboard/analytics");
      })
      .catch(() => setPhase("category"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function savePhone(e: React.FormEvent) {
    e.preventDefault();
    if (phone.replace(/\D/g, "").length < 7) {
      setPhoneError(he ? "מספר הטלפון לא נראה תקין" : "That phone number doesn't look right");
      return;
    }
    setSavingPhone(true);
    setPhoneError(null);
    try {
      await apiFetch("/api/business/me", {
        method: "PUT",
        body: JSON.stringify({ notificationPhone: phone, notificationPhoneDialCode: dialCode }),
      });
      const me = await apiFetch<{ businessTypeChosenAt?: string | null }>("/api/business/me");
      // A full load when leaving: the dashboard shell read /me once on mount and still believes
      // there is no number — its banner and gate would disagree with what was just saved.
      if (me.businessTypeChosenAt) window.location.assign("/dashboard/analytics");
      else setPhase("category");
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : he ? "לא הצלחנו לשמור" : "Could not save");
    } finally {
      setSavingPhone(false);
    }
  }

  useEffect(() => {
    apiFetch<{ templates: TemplateCard[] }>("/api/business/me/templates")
      .then((d) => setTemplates(d.templates))
      // Reported separately from `error` (which carries apply failures) and rendered in place of
      // the cards — otherwise a failed load leaves the skeletons spinning forever.
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  async function confirm() {
    if (!selected) return;
    setApplying(true);
    setError(null);
    try {
      await apiFetch("/api/business/me/apply-template", {
        method: "POST",
        body: JSON.stringify({ type: selected }),
      });
      // A freshly-onboarded business's natural next step is connecting WhatsApp.
      router.replace("/dashboard/whatsapp");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply");
      setApplying(false);
    }
  }

  if (phase === "loading") {
    return (
      <div className="max-w-md mx-auto">
        <SkeletonCard lines={4} />
      </div>
    );
  }

  if (phase === "phone") {
    return (
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="mb-6 text-center animate-fade-up">
          <h1 className="text-2xl font-bold text-gray-900">{he ? "מה המספר שלכם?" : "What's your number?"}</h1>
          <p className="text-gray-600 text-sm mt-2">
            {he
              ? "מהמספר הזה תנהלו את העסק בוואטסאפ ותקבלו התראות על כל תור חדש. חצי דקה, ואי אפשר בלעדיו."
              : "You'll run the business from WhatsApp with this number and get an alert on every new booking. Thirty seconds, and nothing works without it."}
          </p>
        </div>
        <form onSubmit={savePhone} className="bg-white border border-gray-200 rounded-2xl p-6 animate-fade-up stagger-1">
          <label htmlFor="onboarding-phone" className="block text-sm font-medium text-gray-700 mb-1.5">
            {he ? "הטלפון שלכם (וואטסאפ)" : "Your phone (WhatsApp)"}
          </label>
          <div className="flex gap-2" dir="ltr">
            <select
              value={dialCode}
              onChange={(e) => setDialCode(e.target.value)}
              aria-label={he ? "קידומת מדינה" : "Country code"}
              className="w-40 shrink-0"
              dir="ltr"
            >
              {DIAL_CODES.map((c) => (
                <option key={c.code} value={c.code}>+{c.code} {he ? c.he : c.label}</option>
              ))}
            </select>
            <input
              id="onboarding-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0501234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full"
              dir="ltr"
              autoFocus
              required
            />
          </div>
          {phoneError && <p className="text-red-600 text-xs mt-2">{phoneError}</p>}
          <button
            type="submit"
            disabled={savingPhone}
            className="mt-4 w-full bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
          >
            {savingPhone ? (he ? "שומר…" : "Saving…") : he ? "המשך" : "Continue"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <div className="mb-8 text-center animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">
          {he ? "איזה סוג עסק אתם?" : "What kind of business are you?"}
        </h1>
        <p className="text-gray-600 text-sm mt-2 max-w-lg mx-auto">
          {he
            ? "בחרו קטגוריה ותורי תגדיר עבורכם הכל מראש — שירותים לדוגמה, מדיניות ביטולים, טון הבוט ועוד. תמיד אפשר לשנות אחר כך."
            : "Pick a category and Tori will pre-configure everything — sample services, cancellation policy, bot tone and more. You can change anything later."}
        </p>
      </div>

      {loadError ? (
        <div className="bg-white border border-red-200 rounded-2xl p-8 text-center">
          <p className="text-gray-700 text-sm font-medium">{he ? "לא הצלחנו לטעון את הקטגוריות" : "Couldn't load the categories"}</p>
          <p className="text-gray-500 text-xs mt-1">{loadError}</p>
          <button
            onClick={() => { setLoadError(null); location.reload(); }}
            className="mt-4 text-sm font-medium text-[#197492] hover:text-[#145F78] px-3 py-1.5 rounded-lg hover:bg-[#E0F5FB] transition"
          >
            {he ? "נסו שוב" : "Try again"}
          </button>
        </div>
      ) : !templates ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 animate-fade-up stagger-1">
          {templates.map((tpl) => {
            const isSel = selected === tpl.type;
            return (
              <button
                key={tpl.type}
                onClick={() => setSelected(tpl.type)}
                className={`text-start bg-white rounded-2xl p-5 border-2 transition ${
                  isSel ? "border-[#1B7FA0] shadow-lg" : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span aria-hidden="true" className="text-3xl w-9 shrink-0 text-center leading-none">{tpl.emoji}</span>
                  <span className="text-lg font-bold text-gray-900">{he ? tpl.labelHe : tpl.labelEn}</span>
                  {isSel && (
                    <span className="ms-auto w-6 h-6 rounded-full bg-[#1B7FA0] text-white flex items-center justify-center text-sm">
                      ✓
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600 leading-relaxed mb-3">{he ? tpl.descriptionHe : tpl.descriptionEn}</p>
                <div className="flex flex-wrap gap-1.5">
                  {tpl.sampleServices.map((s) => (
                    <span key={s} dir="auto" className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                      {s}
                    </span>
                  ))}
                </div>
                <div className="flex gap-3 mt-3 text-xs text-gray-600">
                  {tpl.depositEnabled && <span>💳 {he ? `מקדמה ₪${tpl.depositAmountIls}` : `Deposit ₪${tpl.depositAmountIls}`}</span>}
                  {tpl.reviewsEnabled && <span>⭐ {he ? "בקשת ביקורת" : "Review requests"}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="text-red-600 text-sm mt-4 text-center">{error}</p>}

      <div className="mt-8 flex justify-center">
        <button
          onClick={confirm}
          disabled={!selected || applying}
          className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-8 py-3 rounded-xl transition"
        >
          {applying
            ? (he ? "מגדיר..." : "Setting up...")
            : (he ? "המשיכו להגדרת תורי" : "Continue & set up Tori")}
        </button>
      </div>
    </div>
  );
}
