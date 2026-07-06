"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SavedBadge } from "../../lib/SavedBadge";

const PAYMENT_PROVIDERS = ["payplus", "tranzila", "cardcom"] as const;
type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

const INVOICE_PROVIDERS = ["greeninvoice", "icount", "payplus-invoice"] as const;
type InvoiceProviderName = (typeof INVOICE_PROVIDERS)[number];

const PAYMENT_LABELS: Record<PaymentProviderName, string> = { payplus: "PayPlus", tranzila: "Tranzila", cardcom: "Cardcom" };
const INVOICE_LABELS: Record<InvoiceProviderName, string> = {
  greeninvoice: "חשבונית ירוקה (Green Invoice)",
  icount: "iCount",
  "payplus-invoice": "PayPlus חשבונית+",
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface Me {
  id: string;
  paymentConnected: boolean;
  paymentProvider?: string | null;
  invoiceConnected: boolean;
  invoiceProvider?: string | null;
}

function ConnectedBadge({ connected, connectedText, notConnectedText }: { connected: boolean; connectedText: string; notConnectedText: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
        connected ? "bg-green-50 text-green-700 border border-green-200" : "bg-gray-100 text-gray-500 border border-gray-200"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-400" : "bg-gray-300"}`} />
      {connected ? connectedText : notConnectedText}
    </span>
  );
}

export default function PaymentsPage() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [me, setMe] = useState<Me | null>(null);

  const [paymentProvider, setPaymentProvider] = useState<PaymentProviderName>("payplus");
  const [paymentApiKey, setPaymentApiKey] = useState("");
  const [paymentApiSecret, setPaymentApiSecret] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentSaved, setPaymentSaved] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const [invoiceProvider, setInvoiceProvider] = useState<InvoiceProviderName>("greeninvoice");
  const [invoiceApiKey, setInvoiceApiKey] = useState("");
  const [invoiceApiSecret, setInvoiceApiSecret] = useState("");
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [invoiceSaved, setInvoiceSaved] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  async function load() {
    const data = await apiFetch<Me>("/api/business/me");
    setMe(data);
    if (data.paymentProvider) setPaymentProvider(data.paymentProvider as PaymentProviderName);
    if (data.invoiceProvider) setInvoiceProvider(data.invoiceProvider as InvoiceProviderName);
  }

  useEffect(() => {
    load();
  }, []);

  async function connectPayment(e: React.FormEvent) {
    e.preventDefault();
    setSavingPayment(true);
    setPaymentError(null);
    try {
      await apiFetch("/api/business/me/payment-provider", {
        method: "PUT",
        body: JSON.stringify({ provider: paymentProvider, apiKey: paymentApiKey, apiSecret: paymentApiSecret }),
      });
      setPaymentApiKey(""); setPaymentApiSecret("");
      setPaymentSaved(true);
      await load();
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setSavingPayment(false);
    }
  }

  async function disconnectPayment() {
    if (!confirm(he ? "לנתק את ספק הסליקה?" : "Disconnect the payment provider?")) return;
    await apiFetch("/api/business/me/payment-provider", { method: "DELETE" });
    setPaymentSaved(false);
    await load();
  }

  async function connectInvoice(e: React.FormEvent) {
    e.preventDefault();
    setSavingInvoice(true);
    setInvoiceError(null);
    try {
      await apiFetch("/api/business/me/invoice-provider", {
        method: "PUT",
        body:
          invoiceProvider === "payplus-invoice"
            ? JSON.stringify({ provider: invoiceProvider })
            : JSON.stringify({ provider: invoiceProvider, apiKey: invoiceApiKey, apiSecret: invoiceApiSecret }),
      });
      setInvoiceApiKey(""); setInvoiceApiSecret("");
      setInvoiceSaved(true);
      await load();
    } catch (err) {
      setInvoiceError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setSavingInvoice(false);
    }
  }

  async function disconnectInvoice() {
    if (!confirm(he ? "לנתק את ספק החשבוניות?" : "Disconnect the invoice provider?")) return;
    await apiFetch("/api/business/me/invoice-provider", { method: "DELETE" });
    setInvoiceSaved(false);
    await load();
  }

  const canUsePayplusInvoice = me?.paymentProvider === "payplus" && me?.paymentConnected;

  return (
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{he ? "סליקה וחשבוניות" : "Payments & Invoicing"}</h1>
        <p className="text-gray-500 text-sm mt-1">
          {he
            ? "חבר את חשבון הסליקה וחשבון החשבוניות שלך — הכסף עובר ישירות אליך, אנחנו רק מתאמים בין הצדדים."
            : "Connect your own payment and invoicing accounts — money goes straight to you, we just orchestrate between them."}
        </p>
      </div>

      {/* Payment provider */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">{he ? "ספק סליקה" : "Payment provider"}</h2>
          <div className="flex items-center gap-2">
            <ConnectedBadge
              connected={Boolean(me?.paymentConnected)}
              connectedText={he ? "מחובר" : "Connected"}
              notConnectedText={he ? "לא מחובר" : "Not connected"}
            />
            {paymentSaved && <SavedBadge text={he ? "נשמר" : "Saved"} />}
          </div>
        </div>

        <form onSubmit={connectPayment} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">{he ? "ספק" : "Provider"}</label>
            <select value={paymentProvider} onChange={(e) => setPaymentProvider(e.target.value as PaymentProviderName)} className="w-full">
              {PAYMENT_PROVIDERS.map((p) => (
                <option key={p} value={p}>{PAYMENT_LABELS[p]}</option>
              ))}
            </select>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">API Key</label>
              <input value={paymentApiKey} onChange={(e) => setPaymentApiKey(e.target.value)} placeholder="API Key" required className="w-full" dir="ltr" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">API Secret</label>
              <input value={paymentApiSecret} onChange={(e) => setPaymentApiSecret(e.target.value)} placeholder="API Secret" required className="w-full" dir="ltr" type="password" />
            </div>
          </div>
          {paymentError && <p className="text-red-600 text-xs">{paymentError}</p>}
          <div className="flex items-center gap-3 mt-1">
            <button type="submit" disabled={savingPayment} className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition">
              {savingPayment ? (he ? "מתחבר..." : "Connecting...") : (he ? "חבר" : "Connect")}
            </button>
            {me?.paymentConnected && (
              <button type="button" onClick={disconnectPayment} className="text-xs text-red-500 hover:text-red-600 transition">
                {he ? "נתק" : "Disconnect"}
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Invoice provider */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">{he ? "ספק חשבוניות" : "Invoice provider"}</h2>
          <div className="flex items-center gap-2">
            <ConnectedBadge
              connected={Boolean(me?.invoiceConnected)}
              connectedText={he ? "מחובר" : "Connected"}
              notConnectedText={he ? "לא מחובר" : "Not connected"}
            />
            {invoiceSaved && <SavedBadge text={he ? "נשמר" : "Saved"} />}
          </div>
        </div>

        <form onSubmit={connectInvoice} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">{he ? "ספק" : "Provider"}</label>
            <select value={invoiceProvider} onChange={(e) => setInvoiceProvider(e.target.value as InvoiceProviderName)} className="w-full">
              {INVOICE_PROVIDERS.map((p) => (
                <option key={p} value={p} disabled={p === "payplus-invoice" && !canUsePayplusInvoice}>
                  {INVOICE_LABELS[p]}{p === "payplus-invoice" && !canUsePayplusInvoice ? (he ? " (דורש חיבור PayPlus)" : " (requires PayPlus connected)") : ""}
                </option>
              ))}
            </select>
          </div>

          {invoiceProvider === "payplus-invoice" ? (
            <p className="text-xs text-gray-500">
              {he
                ? "ישתמש באותם פרטי ההתחברות של PayPlus שכבר חיברת — אין צורך במפתחות נוספים."
                : "Uses the same PayPlus credentials you already connected above — no extra keys needed."}
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">API Key</label>
                <input value={invoiceApiKey} onChange={(e) => setInvoiceApiKey(e.target.value)} placeholder="API Key" required className="w-full" dir="ltr" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">API Secret</label>
                <input value={invoiceApiSecret} onChange={(e) => setInvoiceApiSecret(e.target.value)} placeholder="API Secret" required className="w-full" dir="ltr" type="password" />
              </div>
            </div>
          )}

          {invoiceError && <p className="text-red-600 text-xs">{invoiceError}</p>}
          <div className="flex items-center gap-3 mt-1">
            <button type="submit" disabled={savingInvoice} className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition">
              {savingInvoice ? (he ? "מתחבר..." : "Connecting...") : (he ? "חבר" : "Connect")}
            </button>
            {me?.invoiceConnected && (
              <button type="button" onClick={disconnectInvoice} className="text-xs text-red-500 hover:text-red-600 transition">
                {he ? "נתק" : "Disconnect"}
              </button>
            )}
          </div>
        </form>
      </div>

      {me?.paymentConnected && me.paymentProvider && (
        <div className="mt-4">
          <p className="text-xs text-gray-400 mb-1.5">
            {he
              ? "הגדר את כתובת ה-Webhook הבאה בממשק ה-" + PAYMENT_LABELS[me.paymentProvider as PaymentProviderName] + " שלך כדי שקבלות יופקו אוטומטית לאחר תשלום מוצלח:"
              : `Set the following webhook URL in your ${PAYMENT_LABELS[me.paymentProvider as PaymentProviderName]} dashboard so receipts are issued automatically on successful payment:`}
          </p>
          <code className="block text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-600 break-all" dir="ltr">
            {`${API_URL}/webhook/payments/${me.paymentProvider}/${me.id}`}
          </code>
        </div>
      )}
    </div>
  );
}
