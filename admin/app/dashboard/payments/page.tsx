"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SavedBadge } from "../../lib/SavedBadge";

const PAYMENT_PROVIDERS = ["payplus", "tranzila", "cardcom", "grow"] as const;
type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

const INVOICE_PROVIDERS = ["greeninvoice", "icount", "payplus-invoice"] as const;
type InvoiceProviderName = (typeof INVOICE_PROVIDERS)[number];

const MANAGED_PAYMENT_SURCHARGE_ILS = 49;
const MANAGED_INVOICE_SURCHARGE_ILS = 39;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface ProviderMeta {
  label: string;
  color: string;
  monogram: string;
  instructions: { he: string; en: string } | null;
  instructionsUrl?: string;
}

const PAYMENT_META: Record<PaymentProviderName, ProviderMeta> = {
  payplus: {
    label: "PayPlus",
    color: "#0F62FE",
    monogram: "PP",
    instructions: {
      he: "היכנס לחשבון PayPlus ← הגדרות ← מפתחות API, והעתק את ה-API Key וה-Secret Key.",
      en: "Log into PayPlus → Settings → API Keys, and copy your API Key and Secret Key.",
    },
    instructionsUrl: "https://console.payplus.co.il/",
  },
  tranzila: {
    label: "Tranzila",
    color: "#E4572E",
    monogram: "TZ",
    instructions: {
      he: "שם המסוף (Terminal) שלך ב-Tranzila משמש כ-API Key. הסיסמה/מפתח ה-API נמצאים תחת הגדרות ← אבטחה.",
      en: "Your Tranzila terminal name is used as the API Key. The API password/secret is under Settings → Security.",
    },
    instructionsUrl: "https://web.tranzila.com/",
  },
  cardcom: {
    label: "Cardcom",
    color: "#8E44AD",
    monogram: "CC",
    instructions: {
      he: "היכנס לחשבון Cardcom ← הגדרות טרמינל, והעתק את מספר הטרמינל (TerminalNumber) ואת שם ה-API (ApiName).",
      en: "Log into Cardcom → Terminal Settings, and copy your TerminalNumber and ApiName.",
    },
    instructionsUrl: "https://secure.cardcom.solutions/",
  },
  grow: {
    label: "Grow",
    color: "#00C48C",
    monogram: "GR",
    instructions: {
      he: "היכנס לחשבון Grow ← הגדרות ← API, והעתק את מזהה המשתמש (userId) ואת קוד הדף (pageCode).",
      en: "Log into Grow → Settings → API, and copy your userId and pageCode.",
    },
    instructionsUrl: "https://meshulam.co.il/",
  },
};

const INVOICE_META: Record<InvoiceProviderName, ProviderMeta> = {
  greeninvoice: {
    label: "חשבונית ירוקה",
    color: "#00A651",
    monogram: "GI",
    instructions: {
      he: "היכנס לחשבונית ירוקה ← הגדרות ← API, וצור זוג מפתחות (Key ו-Secret) חדש.",
      en: "Log into Green Invoice → Settings → API, and generate a new Key/Secret pair.",
    },
    instructionsUrl: "https://app.greeninvoice.co.il/api-keys",
  },
  icount: {
    label: "iCount",
    color: "#F5A623",
    monogram: "iC",
    instructions: {
      he: "מזהה החברה (cid) נמצא בכתובת ה-URL של החשבון. את ה-API Token מייצרים תחת הגדרות ← API.",
      en: "Your company id (cid) is in your account's URL. Generate an API Token under Settings → API.",
    },
    instructionsUrl: "https://app.icount.co.il/",
  },
  "payplus-invoice": {
    label: "PayPlus חשבונית+",
    color: "#0F62FE",
    monogram: "P+",
    instructions: null, // reuses payment credentials — no separate setup
  },
};

interface Me {
  id: string;
  paymentConnected: boolean;
  paymentProvider?: string | null;
  invoiceConnected: boolean;
  invoiceProvider?: string | null;
}

function ProviderIcon({ color, monogram, size = "md" }: { color: string; monogram: string; size?: "sm" | "md" }) {
  const dims = size === "sm" ? "w-6 h-6 text-[9px]" : "w-9 h-9 text-xs";
  return (
    <span
      className={`${dims} rounded-lg flex items-center justify-center shrink-0 text-white font-bold tracking-tight shadow-sm`}
      style={{ backgroundColor: color }}
      dir="ltr"
    >
      {monogram}
    </span>
  );
}

function ConnectedPill({ connected, he }: { connected: boolean; he: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
        connected ? "bg-green-50 text-green-700 border border-green-200" : "bg-gray-100 text-gray-500 border border-gray-200"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-400" : "bg-gray-300"}`} />
      {connected ? (he ? "מחובר" : "Connected") : (he ? "לא מחובר" : "Not connected")}
    </span>
  );
}

function ProviderCard<T extends string>({
  he,
  title,
  options,
  meta,
  selected,
  onSelect,
  connected,
  connectedProvider,
  onConnect,
  onDisconnect,
  needsCredentials,
  requirementNote,
}: {
  he: boolean;
  title: string;
  options: readonly T[];
  meta: Record<T, ProviderMeta>;
  selected: T;
  onSelect: (v: T) => void;
  connected: boolean;
  connectedProvider?: string | null;
  onConnect: (apiKey: string, apiSecret: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
  needsCredentials: boolean;
  requirementNote?: string;
}) {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const info = meta[selected];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onConnect(apiKey, apiSecret);
      setApiKey(""); setApiSecret("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        <ProviderIcon color={info.color} monogram={info.monogram} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-400 truncate">{info.label}</p>
        </div>
        <ConnectedPill connected={connected} he={he} />
        {saved && <SavedBadge text={he ? "נשמר" : "Saved"} />}
      </div>

      <div className="p-5">
        {/* Provider tabs */}
        <div className="flex flex-wrap gap-2 mb-4">
          {options.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onSelect(p)}
              className={`flex items-center gap-1.5 text-xs font-semibold pe-3 ps-1.5 py-1.5 rounded-lg border transition ${
                selected === p
                  ? "text-white border-transparent"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
              }`}
              style={selected === p ? { backgroundColor: meta[p].color } : undefined}
            >
              <ProviderIcon color={selected === p ? "rgba(255,255,255,0.25)" : meta[p].color} monogram={meta[p].monogram} size="sm" />
              {meta[p].label}
              {connectedProvider === p && connected && " ✓"}
            </button>
          ))}
        </div>

        {info.instructions && (
          <div className="flex gap-2.5 bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-3 mb-4">
            <svg className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-gray-500 leading-relaxed">
              {he ? info.instructions.he : info.instructions.en}
              {info.instructionsUrl && (
                <>
                  {" "}
                  <a href={info.instructionsUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    {he ? "מעבר לחשבון" : "Go to account"}
                  </a>
                </>
              )}
            </p>
          </div>
        )}

        {requirementNote ? (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5 mb-1">{requirementNote}</p>
        ) : needsCredentials ? (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">API Key</label>
                <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API Key" required className="w-full" dir="ltr" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">API Secret</label>
                <input value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="API Secret" required className="w-full" dir="ltr" type="password" />
              </div>
            </div>
            {error && <p className="text-red-600 text-xs">{error}</p>}
            <div className="flex items-center gap-3 mt-1">
              <button
                type="submit"
                disabled={saving}
                className="text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition disabled:opacity-50"
                style={{ backgroundColor: info.color }}
              >
                {saving ? (he ? "מתחבר..." : "Connecting...") : (he ? "חבר" : "Connect")}
              </button>
              {connected && (
                <button
                  type="button"
                  disabled={disconnecting}
                  onClick={async () => {
                    if (!confirm(he ? "לנתק?" : "Disconnect?")) return;
                    setDisconnecting(true);
                    try { await onDisconnect(); setSaved(false); } finally { setDisconnecting(false); }
                  }}
                  className="text-xs text-red-500 hover:text-red-600 disabled:opacity-50 transition"
                >
                  {he ? "נתק" : "Disconnect"}
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => submit({ preventDefault: () => {} } as React.FormEvent)}
              className="text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition disabled:opacity-50"
              style={{ backgroundColor: info.color }}
            >
              {saving ? (he ? "מתחבר..." : "Connecting...") : (he ? "חבר" : "Connect")}
            </button>
            {connected && (
              <button
                type="button"
                disabled={disconnecting}
                onClick={async () => {
                  if (!confirm(he ? "לנתק?" : "Disconnect?")) return;
                  setDisconnecting(true);
                  try { await onDisconnect(); setSaved(false); } finally { setDisconnecting(false); }
                }}
                className="text-xs text-red-500 hover:text-red-600 disabled:opacity-50 transition"
              >
                {he ? "נתק" : "Disconnect"}
              </button>
            )}
            {error && <p className="text-red-600 text-xs">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Distinct from ProviderCard on purpose — this isn't "one more provider to pick from", it's Tori
 * itself stepping in as a fallback, so it gets its own visual identity (dashed gold border,
 * no tabs, just a single toggle) instead of living as a tab inside the provider list. */
function ManagedCard({
  he,
  kind,
  active,
  surchargeIls,
  description,
  legalNote,
  onEnable,
  onDisable,
}: {
  he: boolean;
  kind: "payment" | "invoice";
  active: boolean;
  surchargeIls: number;
  description: string;
  legalNote?: string;
  onEnable: () => Promise<void>;
  onDisable: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setError(null);
    setLoading(true);
    try {
      if (active) await onDisable();
      else await onEnable();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="rounded-2xl overflow-hidden border-2 border-dashed"
      style={{ borderColor: "#C08A00", background: "linear-gradient(180deg, #FFFBEF 0%, #FFFFFF 55%)" }}
    >
      <div className="flex items-center gap-3 px-5 py-4">
        <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-white font-bold text-xs shadow-sm" style={{ backgroundColor: "#C08A00" }} dir="ltr">
          T
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-gray-900">
            {kind === "payment"
              ? (he ? "אין לך ספק סליקה? תורי תעבד עבורך" : "No payment provider? Let Tori handle it")
              : (he ? "אין לך ספק חשבוניות? תורי תפיק עבורך" : "No invoicing provider? Let Tori handle it")}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "#8A6400" }}>
            {he ? `תוספת ₪${surchargeIls}/חודש` : `+₪${surchargeIls}/month`}
          </p>
        </div>
        {active && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            {he ? "פעיל" : "Active"}
          </span>
        )}
      </div>

      <div className="px-5 pb-5">
        <p className="text-xs text-gray-500 leading-relaxed mb-3">{description}</p>
        {legalNote && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5 leading-relaxed mb-3">{legalNote}</p>
        )}
        {error && <p className="text-red-600 text-xs mb-2">{error}</p>}
        <button
          type="button"
          onClick={toggle}
          disabled={loading}
          className={`text-sm font-semibold px-5 py-2.5 rounded-lg transition disabled:opacity-50 ${
            active ? "bg-white text-red-600 border border-red-200 hover:bg-red-50" : "text-white"
          }`}
          style={active ? undefined : { backgroundColor: "#C08A00" }}
        >
          {loading
            ? (he ? "מעדכן..." : "Updating...")
            : active
              ? (he ? "בטל שירות מנוהל" : "Disable managed service")
              : (he ? "הפעל שירות מנוהל" : "Enable managed service")}
        </button>
      </div>
    </div>
  );
}

export default function PaymentsPage() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [me, setMe] = useState<Me | null>(null);
  const [paymentProvider, setPaymentProvider] = useState<PaymentProviderName>("payplus");
  const [invoiceProvider, setInvoiceProvider] = useState<InvoiceProviderName>("greeninvoice");

  async function load() {
    const data = await apiFetch<Me>("/api/business/me");
    setMe(data);
    if ((PAYMENT_PROVIDERS as readonly string[]).includes(data.paymentProvider ?? "")) {
      setPaymentProvider(data.paymentProvider as PaymentProviderName);
    }
    if ((INVOICE_PROVIDERS as readonly string[]).includes(data.invoiceProvider ?? "")) {
      setInvoiceProvider(data.invoiceProvider as InvoiceProviderName);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const canUsePayplusInvoice = me?.paymentProvider === "payplus" && me?.paymentConnected;

  return (
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{he ? "סליקה וחשבוניות" : "Payments & Invoicing"}</h1>
        <p className="text-gray-500 text-sm mt-1 max-w-xl">
          {he
            ? "חבר את חשבון הסליקה וחשבון החשבוניות שכבר יש לך — הכסף עובר ישירות אליך, אנחנו רק מתאמים בין הצדדים ומפיקים קבלות אוטומטית."
            : "Connect the payment and invoicing accounts you already have — money goes straight to you, we just orchestrate between them and issue receipts automatically."}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 items-start animate-fade-up stagger-1">
        <ProviderCard
          he={he}
          title={he ? "ספק סליקה" : "Payment provider"}
          options={PAYMENT_PROVIDERS}
          meta={PAYMENT_META}
          selected={paymentProvider}
          onSelect={setPaymentProvider}
          connected={Boolean(me?.paymentConnected) && me?.paymentProvider !== "tori_managed"}
          connectedProvider={me?.paymentProvider}
          needsCredentials
          onConnect={async (apiKey, apiSecret) => {
            await apiFetch("/api/business/me/payment-provider", {
              method: "PUT",
              body: JSON.stringify({ provider: paymentProvider, apiKey, apiSecret }),
            });
            await load();
          }}
          onDisconnect={async () => {
            await apiFetch("/api/business/me/payment-provider", { method: "DELETE" });
            await load();
          }}
        />

        <ProviderCard
          he={he}
          title={he ? "ספק חשבוניות" : "Invoice provider"}
          options={INVOICE_PROVIDERS}
          meta={INVOICE_META}
          selected={invoiceProvider}
          onSelect={setInvoiceProvider}
          connected={Boolean(me?.invoiceConnected) && me?.invoiceProvider !== "tori_managed"}
          connectedProvider={me?.invoiceProvider}
          needsCredentials={invoiceProvider !== "payplus-invoice"}
          requirementNote={
            invoiceProvider === "payplus-invoice" && !canUsePayplusInvoice
              ? he
                ? "חבר קודם את PayPlus כספק הסליקה שלך כדי להשתמש ב-חשבונית+ (משתמש באותם פרטי התחברות, ללא מפתחות נוספים)."
                : "Connect PayPlus as your payment provider first to use Invoice+ (it reuses the same credentials, no extra keys)."
              : undefined
          }
          onConnect={async (apiKey, apiSecret) => {
            await apiFetch("/api/business/me/invoice-provider", {
              method: "PUT",
              body:
                invoiceProvider === "payplus-invoice"
                  ? JSON.stringify({ provider: invoiceProvider })
                  : JSON.stringify({ provider: invoiceProvider, apiKey, apiSecret }),
            });
            await load();
          }}
          onDisconnect={async () => {
            await apiFetch("/api/business/me/invoice-provider", { method: "DELETE" });
            await load();
          }}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2 items-start mt-5 animate-fade-up stagger-2">
        <ManagedCard
          he={he}
          kind="payment"
          active={me?.paymentProvider === "tori_managed"}
          surchargeIls={MANAGED_PAYMENT_SURCHARGE_ILS}
          description={
            he
              ? "אין לך חשבון סליקה משלך? תורי תעבד את התשלומים דרך החשבון שלנו במקומך — אין צורך במפתחות API."
              : "Don't have your own payment account? Tori will process payments through our own account for you — no API keys needed."
          }
          onEnable={async () => {
            await apiFetch("/api/business/me/payment-provider", { method: "PUT", body: JSON.stringify({ provider: "tori_managed" }) });
            await load();
          }}
          onDisable={async () => {
            await apiFetch("/api/business/me/payment-provider", { method: "DELETE" });
            await load();
          }}
        />

        <ManagedCard
          he={he}
          kind="invoice"
          active={me?.invoiceProvider === "tori_managed"}
          surchargeIls={MANAGED_INVOICE_SURCHARGE_ILS}
          description={
            he
              ? "אין לך ספק חשבוניות משלך? תורי תפיק עבורך קבלות דרך המערכת שלנו — אין צורך במפתחות API."
              : "Don't have your own invoicing provider? Tori will issue receipts through our own system for you — no API keys needed."
          }
          legalNote={
            he
              ? 'שימו לב: המסמכים יונפקו תחת העסק "תורי" ולא תחת מספר העוסק שלכם — לא מתאים כתחליף להנהלת חשבונות עצמאית.'
              : "Note: documents will be issued under Tori's business, not your own tax ID — not a substitute for independent bookkeeping."
          }
          onEnable={async () => {
            await apiFetch("/api/business/me/invoice-provider", { method: "PUT", body: JSON.stringify({ provider: "tori_managed" }) });
            await load();
          }}
          onDisable={async () => {
            await apiFetch("/api/business/me/invoice-provider", { method: "DELETE" });
            await load();
          }}
        />
      </div>

      {me?.paymentConnected && me.paymentProvider && me.paymentProvider !== "tori_managed" && (
        <div className="mt-5 bg-white border border-gray-200 rounded-2xl px-5 py-4 animate-fade-up stagger-2">
          <p className="text-xs font-semibold text-gray-700 mb-1.5">
            {he ? "כתובת Webhook — להגדרה בממשק הספק" : "Webhook URL — set this in your provider's dashboard"}
          </p>
          <p className="text-xs text-gray-400 mb-2.5">
            {he
              ? "כדי שקבלות יופקו אוטומטית לאחר תשלום מוצלח, הדבק כתובת זו בהגדרות ה-Webhook/Notify של " + PAYMENT_META[me.paymentProvider as PaymentProviderName].label + "."
              : `So receipts get issued automatically on a successful payment, paste this into ${PAYMENT_META[me.paymentProvider as PaymentProviderName].label}'s Webhook/Notify settings.`}
          </p>
          <code className="block text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-600 break-all" dir="ltr">
            {`${API_URL}/webhook/payments/${me.paymentProvider}/${me.id}`}
          </code>
        </div>
      )}
    </div>
  );
}
