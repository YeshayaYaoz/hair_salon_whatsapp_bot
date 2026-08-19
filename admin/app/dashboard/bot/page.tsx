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
  notifyOnDetailsSent?: boolean;
  greetingSeparateMessage?: boolean;
  aiProvider?: string;
  aiModel?: string | null;
  /** null = use the server default. Kept nullable so the slider can express "back to normal". */
  aiTemperature?: number | null;
  greetingButtonText?: string;
  greetingButtonUrl?: string;
  quickReplies?: string[];
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

interface VoiceOption {
  id: string;
  name: string;
  description: string | null;
  gender: "masculine" | "feminine" | "gender_neutral" | null;
  previewUrl: string | null;
}

/**
 * Which voice the phone bot speaks in.
 *
 * One shared agent answers for every salon, so without this every business sounds identical. The
 * choice is grouped by gender because that is the distinction owners actually ask about — a flat
 * list of voice names makes them audition each one to find out.
 */
function VoiceSelect() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [voices, setVoices] = useState<VoiceOption[] | null>(null); // null = loading
  const [selected, setSelected] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ voices: VoiceOption[] }>("/api/business/me/voice-options")
      .then((r) => setVoices(r.voices))
      .catch(() => setVoices([]));
    apiFetch<{ voiceId?: string | null }>("/api/business/me").then((me) => setSelected(me.voiceId ?? ""));
  }, []);

  async function save(voiceId: string) {
    setSaving(true);
    setError(null);
    const previous = selected;
    setSelected(voiceId);
    try {
      // "" is the owner choosing the agent's default back, which is a real choice — so it is sent
      // as an explicit null rather than omitted, which would leave the old voice in place.
      await apiFetch("/api/business/me", {
        method: "PUT",
        body: JSON.stringify({ voiceId: voiceId || null }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSelected(previous);
      setError(err instanceof Error ? err.message : he ? "השמירה נכשלה" : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  // Male and female only. Cartesia's catalogue also carries gender_neutral and unlabelled voices,
  // but the agent inflects its Hebrew from the chosen voice's gender, and Hebrew has no neutral
  // register to inflect into — a "neutral" voice still ends up speaking as one or the other, just
  // unpredictably. So the choice offered is the choice that actually exists.
  const groups: { key: string; labelHe: string; labelEn: string }[] = [
    { key: "feminine", labelHe: "נקבה", labelEn: "Female" },
    { key: "masculine", labelHe: "זכר", labelEn: "Male" },
  ];
  // A voice picked before this narrowing (or set by us directly) may fall outside the two groups.
  // It must stay visible while selected: with no matching option the browser displays "default"
  // while a specific voice is actually pinned — and saving anything else keeps that hidden pin.
  const chosenOutside = (voices ?? []).find(
    (v) => v.id === selected && !groups.some((g) => g.key === v.gender)
  );

  if (voices === null) {
    return (
      <div className="mt-4 pt-4 border-t border-gray-200">
        <SkeletonCard lines={1} />
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-200">
      <label htmlFor="voice-select" className="block text-xs font-medium text-gray-600 mb-1.5">
        {he ? "קול הבוט" : "Bot voice"}
      </label>
      {voices.length === 0 ? (
        <p className="text-xs text-gray-600">
          {he
            ? "בחירת קול אינה זמינה כרגע. הבוט ישתמש בקול ברירת המחדל."
            : "Voice selection is unavailable right now. The bot will use the default voice."}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              id="voice-select"
              value={selected}
              disabled={saving}
              onChange={(e) => save(e.target.value)}
              className="flex-1 min-w-[200px] disabled:opacity-50"
            >
              <option value="">{he ? "ברירת מחדל" : "Default"}</option>
              {groups.map((g) => {
                const inGroup = voices.filter((v) => v.gender === g.key);
                if (!inGroup.length) return null;
                return (
                  <optgroup key={g.key} label={he ? g.labelHe : g.labelEn}>
                    {inGroup.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </optgroup>
                );
              })}
              {chosenOutside && <option value={chosenOutside.id}>{chosenOutside.name}</option>}
            </select>
            {saved && <SavedBadge text={he ? "נשמר" : "Saved"} />}
          </div>
          {/* Only rendered when Cartesia actually has a sample — a play button that does nothing
              is worse than none at all. */}
          {(() => {
            const chosen = voices.find((v) => v.id === selected);
            if (!chosen?.previewUrl) return null;
            return (
              <audio controls src={chosen.previewUrl} className="mt-2 w-full max-w-xs h-8">
                {he ? "הדפדפן שלך לא תומך בהשמעה." : "Your browser cannot play this sample."}
              </audio>
            );
          })()}
          <p className="text-xs text-gray-600 mt-2">
            {he
              ? "הקול שבו הבוט יענה לשיחות הנכנסות שלך. משפיע רק על שיחות טלפון, לא על וואטסאפ."
              : "The voice your incoming calls are answered in. Affects phone calls only, not WhatsApp."}
          </p>
        </>
      )}
      {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
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
  // Shapes the wording only. The server decides who may order — duplicating that rule here would
  // give it two homes, and the copy is the half that would quietly fall out of date.
  const [paying, setPaying] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // One approval request per visit. Every click on the trial path emails the operator, and a
  // second click adds a duplicate to their inbox, not information.
  const [requested, setRequested] = useState(false);
  // Whether Tori has ever ordered a number for this business — NOT whether the field below has a
  // value. Connecting WhatsApp copies the WhatsApp number into voicePhoneNumber automatically
  // (businessRoutes.ts), so gating the offer on "the field is empty" hid it from every business
  // that finished onboarding — which is all of them. This column is set only by an actual order.
  const [hasOrdered, setHasOrdered] = useState(true); // assume yes until loaded: never offer on a guess

  useEffect(() => {
    apiFetch<{ voicePhoneNumber?: string | null; subscriptionStatus?: string; voiceNumberOrderedAt?: string | null }>("/api/business/me").then((me) => {
      setCurrent(me.voicePhoneNumber ?? null);
      setValue(me.voicePhoneNumber ?? "");
      setPaying(me.subscriptionStatus === "active");
      setHasOrdered(Boolean(me.voiceNumberOrderedAt));
    }).catch((err) => {
      // The skeleton is a promise that content is coming. When the load failed it never is, and
      // the error line below the section is the honest replacement.
      setError(err instanceof Error ? err.message : "load failed");
    });
  }, []);

  async function provision() {
    // A number is a recurring monthly charge, so the click that starts one is confirmed. The
    // confirm text names the cost rather than asking "are you sure", which tells nobody anything.
    const confirmText = he
      ? "להנפיק מספר טלפון חדש לעסק? המספר כרוך בתשלום חודשי ויתחיל לענות לשיחות מיד."
      : "Get a new phone number for the business? It carries a monthly charge and will start answering calls right away.";
    if (paying && !window.confirm(confirmText)) return;

    setOrdering(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetch<{ status: string; number?: string; message?: string }>(
        "/api/business/me/voice-phone/provision",
        { method: "POST" }
      );
      if (result.status === "ordered" && result.number) {
        const shown = result.number.startsWith("+") ? result.number : `+${result.number}`;
        setCurrent(result.number);
        setValue(shown);
        setNotice(he ? `המספר ${shown} הונפק וחובר.` : `Number ${shown} is live.`);
        return;
      }
      setNotice(result.message ?? (he ? "הבקשה נשלחה." : "Request sent."));
      setRequested(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : he ? "ההנפקה נכשלה" : "Could not get a number");
    } finally {
      setOrdering(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // The number saves even when Cartesia can't be reached — but then the line won't answer, so
      // the owner has to be told rather than shown a plain "saved".
      const result = await apiFetch<{ warning?: string }>("/api/business/me/voice-phone", {
        method: "PUT",
        body: JSON.stringify({ voicePhoneNumber: value }),
      });
      setCurrent(value);
      if (result.warning) {
        setError(result.warning);
        return;
      }
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
              {he ? "ניתוק" : "Disconnect"}
            </button>
          )}
          {saved && <SavedBadge text={he ? "נשמר" : "Saved"} />}
        </form>
      )}
      {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
      {notice && <p className="text-green-700 text-xs mt-2">{notice}</p>}
      {current !== undefined && !hasOrdered && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-600 mb-2">
            {he
              ? current
                ? "המספר שלמעלה הוא מספר הוואטסאפ שלכם. רוצים קו טלפון ייעודי שעונה רק לשיחות? אפשר להנפיק אחד — הוא יחובר לבוט אוטומטית."
                : paying
                  ? "אין לכם מספר נפרד? אפשר להנפיק אחד עכשיו — הוא יחובר לבוט אוטומטית."
                  : "אין לכם מספר נפרד? אפשר לבקש אחד. עם מנוי פעיל המספר מונפק מיד, אחרת הבקשה עוברת לאישור."
              : current
                ? "The number above is your WhatsApp line. Want a dedicated line that only takes calls? We can issue one and connect it to the bot automatically."
                : paying
                  ? "No separate line? Get one now — it is connected to the bot automatically."
                  : "No separate line? Request one. With an active subscription it is issued immediately, otherwise it goes for approval."}
          </p>
          <button
            type="button"
            onClick={provision}
            disabled={ordering || saving || requested}
            className="bg-white border border-[#1B7FA0] text-[#1B7FA0] hover:bg-[#1B7FA0] hover:text-white disabled:opacity-50 text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            {ordering
              ? he ? "מנפיק..." : "Getting a number..."
              : paying
                ? he ? "הנפיקו לי מספר" : "Get me a number"
                : he ? "בקשו מספר" : "Request a number"}
          </button>
        </div>
      )}
      <VoiceSelect />
      <VoiceLanguageSelect />
      {current ? <VoiceMinutes /> : null}
    </div>
  );
}


/**
 * Which language the phone bot listens in.
 *
 * Separate from the voice, which is how it speaks. Speech recognition pinned to the language
 * actually being spoken is markedly more accurate than one left to guess — an unpinned transcriber
 * turned a spoken email address into a repeated number on a live call — but a salon whose callers
 * switch between Hebrew and English cannot be pinned to either. Only the owner knows which they are.
 */
function VoiceLanguageSelect() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [value, setValue] = useState<string | null>(null); // null = loading
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch<{ voiceLanguage?: string }>("/api/business/me")
      .then((me) => setValue(me.voiceLanguage ?? "he"))
      .catch(() => setValue("he"));
  }, []);

  async function save(next: string) {
    const previous = value;
    setValue(next);
    setSaving(true);
    try {
      await apiFetch("/api/business/me", { method: "PUT", body: JSON.stringify({ voiceLanguage: next }) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setValue(previous);
    } finally {
      setSaving(false);
    }
  }

  if (value === null) return null;

  const options = [
    { key: "he", he: "עברית בלבד", en: "Hebrew only" },
    { key: "en", he: "אנגלית בלבד", en: "English only" },
    { key: "multilingual", he: "עברית ואנגלית", en: "Hebrew and English" },
  ];

  return (
    <div className="mt-4 pt-4 border-t border-gray-200">
      <label htmlFor="voice-language" className="block text-xs font-medium text-gray-600 mb-1.5">
        {he ? "באיזו שפה מתקשרים אליך" : "What language your callers speak"}
      </label>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          id="voice-language"
          value={value}
          disabled={saving}
          onChange={(e) => save(e.target.value)}
          className="flex-1 min-w-[200px] disabled:opacity-50"
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>{he ? o.he : o.en}</option>
          ))}
        </select>
        {saved && <SavedBadge text={he ? "נשמר" : "Saved"} />}
      </div>
      <p className="text-xs text-gray-600 mt-2">
        {he
          ? "כשהבוט יודע מראש באיזו שפה ידברו איתו, הוא מבין הרבה יותר טוב — במיוחד מספרים, שמות וכתובות מייל. בחרו בשתי השפות רק אם באמת מתקשרים אליכם בשתיהן: זה גמיש יותר, אבל קצת פחות מדויק בכל אחת."
          : "The bot understands far more when it knows in advance which language it will hear — especially numbers, names and email addresses. Choose both languages only if callers really do use both: it is more flexible, and slightly less accurate in each."}
      </p>
    </div>
  );
}

interface VoiceUsageWindow {
  calls: number;
  seconds: number;
  costAgorot: number;
}

interface RecentVoiceCall {
  createdAt: string;
  durationSeconds: number | null;
  summary: string | null;
}

/**
 * How much the phone line has actually been used.
 *
 * Every other cost in this product is per message, which owners already have an intuition for. A
 * phone call is billed by the minute, and a bot that handles calls beautifully for an hour is a
 * real expense with nothing on screen to show for it. This is that number — shown to the owner
 * because it is theirs, and shown as calls-and-minutes rather than only shekels because "the bot
 * took 40 calls this month" is the part that tells them it is working.
 */
function VoiceMinutes() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [usage, setUsage] = useState<{
    month: VoiceUsageWindow;
    last30d: VoiceUsageWindow;
    recent: RecentVoiceCall[];
  } | null>(null);

  useEffect(() => {
    // Silent on failure: this is a figure beside the settings, not the settings. An owner changing
    // their number should not meet an error about a usage counter.
    apiFetch<{ month: VoiceUsageWindow; last30d: VoiceUsageWindow; recent: RecentVoiceCall[] }>(
      "/api/business/voice-usage"
    )
      .then(setUsage)
      .catch(() => {});
  }, []);

  if (!usage) return null;
  const minutes = Math.round(usage.month.seconds / 60);

  return (
    <div className="mt-4 pt-4 border-t border-gray-200">
      <div className="flex items-baseline gap-4 flex-wrap">
        <div>
          <div className="text-lg font-semibold text-gray-900 tabular-nums">
            {usage.month.calls} {he ? "שיחות" : "calls"}
          </div>
          <div className="text-xs text-gray-600">{he ? "החודש" : "this month"}</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-gray-900 tabular-nums">
            {minutes} {he ? "דקות" : "min"}
          </div>
          <div className="text-xs text-gray-600">
            {he ? `${Math.round(usage.last30d.seconds / 60)} ב-30 הימים האחרונים` : `${Math.round(usage.last30d.seconds / 60)} in the last 30 days`}
          </div>
        </div>
      </div>
      <p className="text-xs text-gray-600 mt-2">
        {he
          ? "זמן שיחה בפועל שהבוט ענה לו, נמדד לפי רישומי הספק."
          : "Actual talk time the bot answered, measured from the provider's own call records."}
      </p>

      {usage.recent.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold text-gray-900 mb-2">
            {he ? "השיחות האחרונות" : "Recent calls"}
          </h3>
          <ul className="space-y-2">
            {usage.recent.map((c, i) => (
              <li key={i} className="flex items-start gap-3 text-xs">
                <span className="text-gray-600 tabular-nums whitespace-nowrap shrink-0">
                  {new Date(c.createdAt).toLocaleDateString(he ? "he-IL" : "en-GB", { day: "numeric", month: "short" })}
                  {" · "}
                  {formatDuration(c.durationSeconds)}
                </span>
                <span className="text-gray-700">
                  {/* A call the hourly sync recorded has no summary — the provider only sends one
                      with the live event. Saying so beats an empty cell that reads as a bug. */}
                  {c.summary || "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** m:ss — a phone call is minutes and seconds to everyone who has ever been on one. */
function formatDuration(seconds: number | null): string {
  if (!seconds) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

type BotTab = "personality" | "ai" | "policy" | "automated" | "voice";

/** Order is the order an owner sets things up in: how it talks, what runs it, what it may say,
 *  what it sends unprompted, and finally the phone line most salons never turn on. */
const TABS: { key: BotTab; he: string; en: string }[] = [
  { key: "personality", he: "אישיות ופתיחה", en: "Personality" },
  { key: "ai", he: "מנוע AI", en: "AI engine" },
  { key: "policy", he: "מדיניות", en: "Policy" },
  { key: "automated", he: "הודעות אוטומטיות", en: "Automated" },
  { key: "voice", he: "בוט טלפוני", en: "Voice bot" },
];

export default function BotPage() {
  const { t, lang } = useLanguage();
  const he = lang === "he";
  const [fields, setFields] = useState<BotProfile>({
    botGreeting: "", botPersonality: "",
    remindersEnabled: true, reviewsEnabled: true,
    cancellationPolicy: "", referralText: "", digestEnabled: true, availabilityInfo: "",
    pricingNotes: "", availabilitySuggestionsEnabled: true, notifyOnDetailsSent: false, greetingSeparateMessage: false, aiProvider: "anthropic", aiModel: null, aiTemperature: null,
    greetingButtonText: "", greetingButtonUrl: "", quickReplies: [],
  });
  const [bookingModel, setBookingModel] = useState<string>("slot");
  const [botEnabled, setBotEnabled] = useState(true);
  const [togglingBot, setTogglingBot] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiProviders, setAiProviders] = useState<AiProviderMeta[] | null>(null);
  const [tempMeta, setTempMeta] = useState<{ default: number; min: number; max: number }>({ default: 0.2, min: 0, max: 1 });
  const [tempIgnoredBy, setTempIgnoredBy] = useState<string[]>([]);
  const [tab, setTab] = useState<BotTab>("personality");

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
        notifyOnDetailsSent: me.notifyOnDetailsSent ?? false,
        greetingSeparateMessage: me.greetingSeparateMessage ?? false,
        aiProvider: me.aiProvider ?? "anthropic",
        aiModel: me.aiModel ?? null,
        aiTemperature: me.aiTemperature ?? null,
        greetingButtonText: me.greetingButtonText ?? "",
        greetingButtonUrl: me.greetingButtonUrl ?? "",
        quickReplies: me.quickReplies ?? [],
      });
      setBookingModel(me.bookingModel ?? "slot");
      setBotEnabled(me.botEnabled ?? true);
      setLoaded(true);
    }).catch((err) => {
      // Without this the page shows skeletons forever — and worse, `fields` still holds the
      // defaults, so a save from that state would overwrite the business's real settings.
      setLoadError(err instanceof Error ? err.message : "load failed");
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
      setError(err instanceof Error ? err.message : he ? "העדכון נכשל" : "Failed to update");
    } finally {
      setTogglingBot(false);
    }
  }

  function set(key: keyof BotProfile, value: string | number | boolean | string[] | null) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Quick replies are kept raw and positional while typing; empty boxes are dropped only here,
      // because WhatsApp rejects an empty button.
      const payload = {
        ...fields,
        quickReplies: (fields.quickReplies ?? []).map((v) => v.trim()).filter(Boolean),
      };
      await apiFetch("/api/business/me", { method: "PUT", body: JSON.stringify(payload) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : he ? "השמירה נכשלה" : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <div className="animate-fade-in">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">{t.botTabTitle}</h1>
        {loadError ? (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            {he ? "טעינת ההגדרות נכשלה. רעננו את העמוד ונסו שוב." : "Could not load the settings. Refresh the page and try again."}
            <span className="block text-xs text-red-500 mt-1" dir="ltr">{loadError}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
            <SkeletonCard lines={2} />
          </div>
        )}
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
      {/* One row rather than a stacked block: the status is two short lines, and stacking them left
          the button alone at the far edge of a wide screen with the width of the page empty between
          them. Laid out inline, the description fills that space instead of sitting under the title.
          The dot is an element rather than an emoji in the string, so it matches the status dots
          elsewhere in the dashboard and does not inherit the text colour. */}
      <div
        className={`rounded-xl border px-4 py-3 mb-5 flex items-center gap-3 flex-wrap ${
          botEnabled ? "bg-white border-gray-200" : "bg-amber-50 border-amber-300"
        }`}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${botEnabled ? "bg-green-500" : "bg-amber-500"}`}
          aria-hidden
        />
        <p className="text-sm font-semibold text-gray-900 shrink-0">
          {botEnabled
            ? (he ? "הבוט פעיל" : "Bot is active")
            : (he ? "הבוט מושהה" : "Bot is paused")}
        </p>
        <p className="text-xs text-gray-600 flex-1 min-w-[12rem]">
          {botEnabled
            ? (he ? "הבוט עונה ללקוחות בוואטסאפ ומקבל תורים." : "The bot answers customers on WhatsApp and takes bookings.")
            : (he ? "הבוט לא עונה לאף לקוח. ההודעות עדיין נשמרות ותוכלו לענות ידנית." : "The bot answers no one. Messages are still saved so you can reply manually.")}
        </p>
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
          {togglingBot ? "..." : botEnabled ? (he ? "השהה בוט" : "Pause bot") : (he ? "הפעלת הבוט" : "Resume bot")}
        </button>
      </div>

      {/* Five settings groups stacked in one column meant the page opened on a wall of inputs and
          the thing you came to change was somewhere below the fold. They are unrelated to each
          other — how the bot writes, which model runs it, the policy texts, the automated sends,
          the phone line — so showing one at a time costs nothing and makes the choice the first
          thing on the page. Field state lives in `fields` above, so switching keeps unsaved edits
          and Save still writes every group at once. */}
      <nav aria-label={t.sectionTabsLabel} className="mb-5 -mx-4 px-4 md:mx-0 md:px-0 overflow-x-auto">
        <div className="inline-flex gap-1 p-1 rounded-xl" style={{ background: "#EAEFF3" }}>
          {TABS.map((tb) => (
            <button
              key={tb.key}
              type="button"
              onClick={() => setTab(tb.key)}
              aria-current={tab === tb.key ? "true" : undefined}
              className="whitespace-nowrap px-3.5 py-2 rounded-lg text-[13px] font-semibold transition"
              style={
                tab === tb.key
                  ? { background: "#FFFFFF", color: "#136B87", boxShadow: "0 1px 2px rgba(15,29,42,0.10)" }
                  : { color: "#4B5563" }
              }
            >
              {he ? tb.he : tb.en}
            </button>
          ))}
        </div>
      </nav>

      <form onSubmit={save} hidden={tab === "voice"}>
        {tab === "personality" && (
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
        <label className="flex items-start justify-between gap-3 mt-2">
          <span className="min-w-0">
            <span className="block text-xs text-gray-700">
              {he ? "לשלוח את הפתיחה כהודעה נפרדת" : "Send the welcome as its own message"}
            </span>
            <span className="block text-[11px] text-gray-600 mt-0.5">
              {he
                ? "כבוי: הפתיחה והתשובה מגיעות יחד, כהודעה אחת — כך זה נקרא כמו אדם. דלוק: שתי הודעות, מה שמשאיר מקום גם לכפתור הקישור וגם לתשובות המהירות. אם הגדרת כפתור קישור, הפתיחה נשלחת בנפרד בכל מקרה."
                : "Off: the welcome and the reply arrive together as one message, which reads like a person. On: two messages, leaving room for both the link button and the quick replies. If you've set a link button, the welcome is sent separately regardless."}
            </span>
          </span>
          <Toggle
            checked={fields.greetingSeparateMessage ?? false}
            onChange={(v) => set("greetingSeparateMessage", v)}
          />
        </label>
          <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 flex flex-col gap-3">
            <div>
              <p className="text-xs font-semibold text-gray-800">{t.quickRepliesTitle}</p>
              <p className="text-xs text-gray-600 mt-1">{t.quickRepliesHint}</p>
            </div>
            <div className="grid sm:grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <input
                  key={i}
                  value={(fields.quickReplies ?? [])[i] ?? ""}
                  onChange={(e) => {
                    // Stored raw and positional. Compacting here re-indexes mid-typing — text
                    // entered in the second box jumped into the first — and trimming per keystroke
                    // ate the space between words as it was typed. Blanks are dropped at save.
                    const next = [...(fields.quickReplies ?? [])];
                    next[i] = e.target.value;
                    set("quickReplies", next);
                  }}
                  placeholder={t.quickReplyPlaceholders[i]}
                  maxLength={20}
                  className="w-full text-sm"
                />
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 flex flex-col gap-3">
            <div>
              <p className="text-xs font-semibold text-gray-800">{t.greetingButtonTitle}</p>
              <p className="text-xs text-gray-600 mt-1">{t.greetingButtonHint}</p>
            </div>
            {/* WhatsApp allows one interactive attachment per message, and the webhook prefers quick
                replies — so with any configured, this button is filled in, saved, and then never
                sent. Silent from the owner's side, which is exactly why it is said here. */}
            {(fields.quickReplies ?? []).some((v) => v.trim()) && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2.5">
                {he
                  ? "הכפתור הזה לא יישלח כרגע: וואטסאפ מאפשר סוג כפתורים אחד בלבד בכל הודעה, ולכפתורי התשובה המהירה שלמעלה יש עדיפות. כדי להשתמש בכפתור הקישור — מחקו את כפתורי התשובה המהירה. אפשר להשאיר את הקישור עצמו בטקסט הברכה."
                  : "This button won't be sent right now: WhatsApp allows only one kind of button per message, and the quick replies above take precedence. To use the link button, remove the quick replies. The link itself can stay in the greeting text."}
              </div>
            )}
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

        )}

        {tab === "ai" && (
        <Section
          title={he ? "מנוע ה-AI" : "AI engine"}
          description={he ? "איזה מודל שפה עונה ללקוחות שלכם בוואטסאפ" : "Which language model answers your customers on WhatsApp"}
        >
          {aiProviders && !aiProviders.find((p) => p.key === fields.aiProvider)?.configured && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2.5">
              {he
                ? "הספק הנבחר לא מוגדר בשרת — הבוט לא יוכל לענות ללקוחות עד שיוגדר עבורו מפתח API."
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
          {fields.aiProvider === "auto" ? (
            <div className="text-xs text-gray-500 px-1">
              {he
                ? "במצב אוטומטי הבוט בוחר בעצמו בין Claude ל-DeepSeek בכל הודעה, לפי המורכבות שלה — אין צורך (ואי אפשר) לבחור מודל ספציפי."
                : "In automatic mode the bot picks Claude or DeepSeek per message based on complexity — there's no specific model to choose here."}
            </div>
          ) : (
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
                {/* A saved model the provider's list no longer carries must still render as an
                    option: with no matching option the browser falls back to showing "Automatic"
                    while a specific model is actually pinned — the display lies. */}
                {fields.aiModel &&
                  !aiProviders?.find((p) => p.key === fields.aiProvider)?.defaultModels.includes(fields.aiModel) && (
                    <option value={fields.aiModel}>{fields.aiModel}</option>
                  )}
                {aiProviders
                  ?.find((p) => p.key === fields.aiProvider)
                  ?.defaultModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
              </select>
            </Field>
          )}

          <TemperatureSlider
            value={fields.aiTemperature ?? null}
            onChange={(v) => set("aiTemperature", v)}
            meta={tempMeta}
            ignored={Boolean(fields.aiModel && tempIgnoredBy.includes(fields.aiModel))}
            he={he}
          />
        </Section>

        )}

        {tab === "policy" && (
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
              placeholder={he ? "לדוגמה: הזמינו חבר וקבלו 10% הנחה בביקור הבא!" : "e.g. Refer a friend and get 10% off your next visit!"}
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

        )}

        {tab === "automated" && (
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
          <label className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-xs text-gray-700">
                {he ? "עדכון כשהבוט הקולי שולח פרטים ותמונות" : "Alert when the voice bot sends details and photos"}
              </span>
              <span className="block text-[11px] text-gray-600 mt-0.5">
                {he
                  ? "כבוי כברירת מחדל. הבוט כבר טיפל בבקשה, והתראה על כל בקשת תמונות מרעישה את אותו ערוץ שדרכו מגיעות התראות על מקדמה ששולמה או העברה שנכשלה."
                  : "Off by default. The bot already handled it, and an alert per photo request adds noise to the same channel that carries paid deposits and failed transfers."}
              </span>
            </span>
            <Toggle
              checked={fields.notifyOnDetailsSent ?? false}
              onChange={(v) => set("notifyOnDetailsSent", v)}
            />
          </label>
        </Section>

        )}

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

      {tab === "voice" && <VoicePhoneSection />}
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
            className="text-xs text-[#197492] hover:underline shrink-0"
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
            ? "המודל שנבחר לא תומך בהגדרה הזאת ומתעלם ממנה. כדי לשלוט במגוון הניסוח, בחרו מודל אחר."
            : "The selected model doesn't support this setting and ignores it. Pick a different model to control wording variety."}
        </p>
      )}
    </div>
  );
}
