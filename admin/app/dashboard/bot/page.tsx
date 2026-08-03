"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SavedBadge } from "../../lib/SavedBadge";
import { SkeletonCard } from "../../lib/Skeleton";
import { Toggle, Section, Field } from "../../lib/SettingsControls";

interface BotProfile {
  botGreeting?: string;
  botPersonality?: string;
  remindersEnabled?: boolean;
  reviewsEnabled?: boolean;
  cancellationPolicy?: string;
  referralText?: string;
  digestEnabled?: boolean;
  availabilityInfo?: string;
  pricingNotes?: string;
  availabilitySuggestionsEnabled?: boolean;
  aiProvider?: string;
  aiModel?: string | null;
  /** null = use the server default. Kept nullable so the slider can express "back to normal". */
  aiTemperature?: number | null;
  greetingButtonText?: string;
  greetingButtonUrl?: string;
}

interface AiProviderMeta {
  key: string;
  label: string;
  configured: boolean;
  defaultModels: string[];
}

interface AiProvidersResponse {
  providers: AiProviderMeta[];
  temperature: { default: number; min: number; max: number };
  /** Models the API has already refused a temperature for. Newer Anthropic models reject the
   * parameter outright, and a slider that quietly does nothing is worse than no slider. */
  temperatureIgnoredBy: string[];
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
          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
            {he ? "לא מחובר" : "Not connected"}
          </span>
        ) : current ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
            {he ? "מחובר" : "Connected"}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-gray-600 mb-4">
        {he
          ? "מספר הטלפון שאליו שיחות נכנסות ייענו ע\"י הבוט הקולי. מתמלא אוטומטית עם מספר הוואטסאפ שלך בעת החיבור — ניתן לשנות ידנית אם יש לך מספר קולי נפרד."
          : "The phone number incoming calls to are answered by the voice bot. Auto-filled with your WhatsApp number once connected — change it manually if you use a separate voice line."}
      </p>
      {current === undefined ? (
        <SkeletonCard lines={1} />
      ) : (
        <form onSubmit={save} className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-600 mb-1.5">{he ? "מספר טלפון" : "Phone number"}</label>
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

export default function BotPage() {
  const { t, lang } = useLanguage();
  const he = lang === "he";
  const [fields, setFields] = useState<BotProfile>({
    botGreeting: "", botPersonality: "",
    remindersEnabled: true, reviewsEnabled: true,
    cancellationPolicy: "", referralText: "", digestEnabled: true, availabilityInfo: "",
    pricingNotes: "", availabilitySuggestionsEnabled: true, aiProvider: "anthropic", aiModel: null, aiTemperature: null,
    greetingButtonText: "", greetingButtonUrl: "",
  });
  const [bookingModel, setBookingModel] = useState<string>("slot");
  const [botEnabled, setBotEnabled] = useState(true);
  const [togglingBot, setTogglingBot] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiProviders, setAiProviders] = useState<AiProviderMeta[] | null>(null);
  const [tempMeta, setTempMeta] = useState<{ default: number; min: number; max: number }>({ default: 0.2, min: 0, max: 1 });
  const [tempIgnoredBy, setTempIgnoredBy] = useState<string[]>([]);

  useEffect(() => {
    apiFetch<BotProfile & { bookingModel?: string; botEnabled?: boolean }>("/api/business/me").then((me) => {
      setFields({
        botGreeting: me.botGreeting ?? "",
        botPersonality: me.botPersonality ?? "",
        remindersEnabled: me.remindersEnabled ?? true,
        reviewsEnabled: me.reviewsEnabled ?? true,
        cancellationPolicy: me.cancellationPolicy ?? "",
        referralText: me.referralText ?? "",
        digestEnabled: me.digestEnabled ?? true,
        availabilityInfo: me.availabilityInfo ?? "",
        pricingNotes: me.pricingNotes ?? "",
        availabilitySuggestionsEnabled: me.availabilitySuggestionsEnabled ?? true,
        aiProvider: me.aiProvider ?? "anthropic",
        aiModel: me.aiModel ?? null,
        aiTemperature: me.aiTemperature ?? null,
        greetingButtonText: me.greetingButtonText ?? "",
        greetingButtonUrl: me.greetingButtonUrl ?? "",
      });
      setBookingModel(me.bookingModel ?? "slot");
      setBotEnabled(me.botEnabled ?? true);
      setLoaded(true);
    });
    apiFetch<AiProvidersResponse>("/api/business/me/ai-providers")
      .then((res) => {
        setAiProviders(res.providers);
        if (res.temperature) setTempMeta(res.temperature);
        setTempIgnoredBy(res.temperatureIgnoredBy ?? []);
      })
      .catch(() => {});
  }, []);

  async function toggleBot() {
    const next = !botEnabled;
    setTogglingBot(true);
    setError(null);
    try {
      await apiFetch("/api/business/me/bot-enabled", { method: "PUT", body: JSON.stringify({ enabled: next }) });
      setBotEnabled(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setTogglingBot(false);
    }
  }

  function set(key: keyof BotProfile, value: string | number | boolean | null) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/business/me", { method: "PUT", body: JSON.stringify(fields) });
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
        <h1 className="text-2xl font-bold text-gray-900 mb-6">{t.botTabTitle}</h1>
        <div className="flex flex-col gap-4">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-4 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{t.botTabTitle}</h1>
        <p className="text-gray-600 text-sm mt-1">{t.botTabSubtitle}</p>
      </div>

      {/* Master on/off switch, kept above the settings form: when the bot is off none of the
          settings below have any effect, so the owner should see that state first. */}
      <div
        className={`rounded-xl border p-4 mb-5 flex items-center gap-4 ${
          botEnabled ? "bg-white border-gray-200" : "bg-amber-50 border-amber-300"
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">
            {botEnabled
              ? (he ? "🟢 הבוט פעיל" : "🟢 Bot is active")
              : (he ? "⏸️ הבוט מושהה" : "⏸️ Bot is paused")}
          </p>
          <p className="text-xs text-gray-600 mt-0.5">
            {botEnabled
              ? (he ? "הבוט עונה ללקוחות בוואטסאפ ומקבל תורים." : "The bot answers customers on WhatsApp and takes bookings.")
              : (he ? "הבוט לא עונה לאף לקוח. ההודעות עדיין נשמרות ותוכל לענות ידנית." : "The bot answers no one. Messages are still saved so you can reply manually.")}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleBot}
          disabled={togglingBot}
          className={`text-xs font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50 shrink-0 ${
            botEnabled
              ? "bg-gray-100 hover:bg-gray-200 text-gray-700"
              : "bg-[#1B7FA0] hover:bg-[#2A9BBF] text-white"
          }`}
        >
          {togglingBot ? "..." : botEnabled ? (he ? "השהה בוט" : "Pause bot") : (he ? "הפעל בוט" : "Resume bot")}
        </button>
      </div>

      <form onSubmit={save}>
        <Section title={t.botPersonalityTitle} description={t.botPersonalityDesc}>
          <Field label={t.greeting} hint={t.greetingHint}>
            <textarea
              rows={4}
              placeholder={t.greetingPlaceholder}
              value={fields.botGreeting}
              onChange={(e) => set("botGreeting", e.target.value)}
              className="w-full"
            />
          </Field>
          <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 flex flex-col gap-3">
            <div>
              <p className="text-xs font-semibold text-gray-800">{t.greetingButtonTitle}</p>
              <p className="text-xs text-gray-600 mt-1">{t.greetingButtonHint}</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label={t.greetingButtonLabel}>
                <input
                  value={fields.greetingButtonText ?? ""}
                  onChange={(e) => set("greetingButtonText", e.target.value)}
                  placeholder={t.greetingButtonLabelPlaceholder}
                  maxLength={20}
                  className="w-full"
                />
              </Field>
              <Field label={t.greetingButtonUrlLabel}>
                <input
                  value={fields.greetingButtonUrl ?? ""}
                  onChange={(e) => set("greetingButtonUrl", e.target.value)}
                  placeholder="https://…"
                  dir="ltr"
                  className="w-full"
                />
              </Field>
            </div>
          </div>

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

        <Section
          title={he ? "מנוע ה-AI" : "AI engine"}
          description={he ? "איזה מודל שפה עונה ללקוחות שלכם בוואטסאפ" : "Which language model answers your customers on WhatsApp"}
        >
          {aiProviders && !aiProviders.find((p) => p.key === fields.aiProvider)?.configured && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2.5">
              {he
                ? "הספק הנבחר לא מוגדר בשרת כרגע — הבוט ימשיך לענות עד שיוגדר מפתח API עבורו."
                : "The selected provider isn't configured on the server yet — the bot will fail to reply until an API key is set for it."}
            </div>
          )}
          <Field label={he ? "ספק" : "Provider"}>
            <select
              value={fields.aiProvider ?? "anthropic"}
              onChange={(e) => { set("aiProvider", e.target.value); set("aiModel", null); }}
              className="w-full"
            >
              {(aiProviders ?? [{ key: "anthropic", label: "Claude (Anthropic)", configured: true, defaultModels: [] }]).map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}{!p.configured ? (he ? " — לא מוגדר" : " — not configured") : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={he ? "מודל (אופציונלי)" : "Model (optional)"}
            hint={
              he
                ? "השאירו ריק כדי לתת לבוט לבחור אוטומטית בין מודל זול למהיר לבין מודל חכם יותר לפי הצורך. בחירת מודל ספציפי מבטלת את הבחירה האוטומטית."
                : "Leave blank to let the bot auto-pick between a cheap/fast model and a smarter one as needed. Picking a specific model turns off that automatic switching."
            }
          >
            <select
              value={fields.aiModel ?? ""}
              onChange={(e) => set("aiModel", e.target.value || null)}
              className="w-full"
            >
              <option value="">{he ? "אוטומטי (מומלץ)" : "Automatic (recommended)"}</option>
              {aiProviders
                ?.find((p) => p.key === fields.aiProvider)
                ?.defaultModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
            </select>
          </Field>

          <TemperatureSlider
            value={fields.aiTemperature ?? null}
            onChange={(v) => set("aiTemperature", v)}
            meta={tempMeta}
            ignored={Boolean(fields.aiModel && tempIgnoredBy.includes(fields.aiModel))}
            he={he}
          />
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
            label={he ? "כללי תמחור והחרגות" : "Pricing rules & exclusions"}
            hint={
              he
                ? "כל מה שלא נכנס למחיר בודד ברשימת המחירים: חבילות, עונות שבהן אין הנחה, ותאריכים שלא כלולים. הבוט לעולם לא מחשב מחירים בעצמו — הוא מוסר רק מחירים שרשומים, ולכל דבר אחר מפנה אליך."
                : "Anything a single listed price can't express: packages, seasons where a discount doesn't apply, excluded dates. The bot never calculates prices itself — it quotes only listed prices and defers everything else to you."
            }
          >
            <textarea
              rows={3}
              placeholder={
                he
                  ? 'לדוגמה: בבין הזמנים המחיר מלא לכל לילה. המחירים לא כוללים ראש השנה ול"ג בעומר.'
                  : "e.g. Peak season is full price per night. Prices exclude holidays."
              }
              value={fields.pricingNotes}
              onChange={(e) => set("pricingNotes", e.target.value)}
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
          {bookingModel === "inquiry" && (
            <>
              <label className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-xs text-gray-700">
                    {he ? "הבוט מוסר מידע על זמינות" : "Bot shares availability info"}
                  </span>
                  <span className="block text-[11px] text-gray-600 mt-0.5">
                    {he
                      ? "כשמכובה, הבוט לא יאמר כלום על זמינות — לא אם תאריך פנוי, לא כמה עמוס, ולא יציע מועדים. הוא ימסור רק מחירים ומידע, ויפנה אליך לכל שאלת זמינות."
                      : "When off, the bot says nothing about availability — not whether a date is free, not how busy it is, and it won't suggest dates. It shares only prices and info, and defers every availability question to you."}
                  </span>
                </span>
                <Toggle
                  checked={fields.availabilitySuggestionsEnabled ?? true}
                  onChange={(v) => set("availabilitySuggestionsEnabled", v)}
                />
              </label>
              {fields.availabilitySuggestionsEnabled !== false && (
                <Field
                  label={he ? "מידע זמינות" : "Availability info"}
                  hint={he ? "מה שהבוט מוסר על זמינות כשלקוח שואל. במצב זה הבוט לא קובע הזמנות — הוא מוסר מידע ומעביר בקשות הזמנה אליך." : "What the bot tells customers about availability. In this mode the bot doesn't book — it shares info and forwards booking requests to you."}
                >
                  <textarea
                    rows={3}
                    placeholder={he ? "לדוגמה: זמינות משתנה — מומלץ להזמין מראש, סופי שבוע נתפסים מהר." : "e.g. Availability varies — book ahead, weekends fill up fast."}
                    value={fields.availabilityInfo}
                    onChange={(e) => set("availabilityInfo", e.target.value)}
                    className="w-full"
                  />
                </Field>
              )}
            </>
          )}
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
    </div>
  );
}

/**
 * Controls how much the bot varies its wording.
 *
 * Low is the default and it is not an arbitrary preference: high temperature is what produced
 * invented Hebrew in production ("מבורך הבא" instead of "ברוך הבא"), because Hebrew is full of
 * fixed collocations where any variation is simply wrong. So the scale is labelled by what it
 * actually does to replies, not by the number — an owner reading "0.8" has no way to know it means
 * "may invent phrasings your customers will notice".
 *
 * When the selected model refuses the parameter (newer Anthropic models answer 400 for it), the
 * control says so and disables itself. A slider that silently does nothing is worse than none.
 */
function TemperatureSlider({
  value,
  onChange,
  meta,
  ignored,
  he,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  meta: { default: number; min: number; max: number };
  ignored: boolean;
  he: boolean;
}) {
  const current = value ?? meta.default;
  const isDefault = value === null;

  const describe = (t: number) =>
    t <= 0.15
      ? he ? "עקבי מאוד — כמעט אותה תשובה בכל פעם" : "Very consistent — near-identical answers"
      : t <= 0.35
        ? he ? "עקבי — מומלץ לעברית" : "Consistent — recommended for Hebrew"
        : t <= 0.6
          ? he ? "מגוון — ניסוחים משתנים" : "Varied — wording changes between replies"
          : he ? "יצירתי — עלול להמציא ניסוחים שגויים" : "Creative — may invent incorrect phrasings";

  return (
    <div className="block">
      <div className="flex items-baseline justify-between mb-1.5">
        <label htmlFor="ai-temperature" className="text-xs font-medium text-gray-600">
          {he ? "מגוון בניסוח" : "Wording variety"}
        </label>
        <span className="text-xs text-gray-600 tabular-nums" dir="ltr">
          {current.toFixed(2)}{isDefault ? (he ? " (ברירת מחדל)" : " (default)") : ""}
        </span>
      </div>

      <input
        id="ai-temperature"
        type="range"
        min={meta.min}
        max={meta.max}
        step={0.05}
        value={current}
        disabled={ignored}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#1B7FA0] disabled:opacity-50"
      />

      <div className="flex items-center justify-between gap-3 mt-1">
        <span className={`text-xs ${current > 0.6 ? "text-amber-700 font-medium" : "text-gray-600"}`}>
          {describe(current)}
        </span>
        {!isDefault && !ignored && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-[#1B7FA0] hover:underline shrink-0"
          >
            {he ? "אפס לברירת מחדל" : "Reset to default"}
          </button>
        )}
      </div>

      <p className="text-xs text-gray-600 mt-1.5">
        {he
          ? "נמוך = הבוט חוזר על אותם ניסוחים מדויקים. גבוה = מגוון יותר, אבל מגדיל את הסיכון לשגיאות עברית אצל הלקוחות."
          : "Low = the bot repeats the same exact wording. High = more variety, but a higher risk of Hebrew errors reaching customers."}
      </p>

      {ignored && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
          {he
            ? "המודל שנבחר לא תומך בהגדרה הזאת ומתעלם ממנה. כדי לשלוט במגוון הניסוח, בחר מודל אחר."
            : "The selected model doesn't support this setting and ignores it. Pick a different model to control wording variety."}
        </p>
      )}
    </div>
  );
}
