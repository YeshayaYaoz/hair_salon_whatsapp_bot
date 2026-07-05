"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SavedBadge } from "../../lib/SavedBadge";

declare global {
  interface Window {
    FB: any;
    fbAsyncInit: () => void;
  }
}

const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || "1556761279502082";
const META_CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID || "1011752745059826";

export default function WhatsAppPage() {
  const { t, lang } = useLanguage();
  const [connected, setConnected] = useState(false);
  const [tokenValid, setTokenValid] = useState(true);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const codeUsedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  async function disconnect() {
    if (!confirm(lang === "he" ? "לנתק את חיבור הוואטסאפ?" : "Disconnect WhatsApp?")) return;
    setDisconnecting(true);
    try {
      await apiFetch("/api/business/me/whatsapp", { method: "DELETE" });
      setConnected(false);
      setPhoneNumber(null);
      setSaved(false);
    } catch (err: any) {
      setError(err?.message ?? "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  }

  // Manual fallback form state
  const [showManual, setShowManual] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ whatsappConnected: boolean; whatsappTokenValid?: boolean; whatsappPhoneNumberId?: string }>("/api/business/me").then((me) => {
      setConnected(me.whatsappConnected);
      setTokenValid(me.whatsappTokenValid !== false);
    });
  }, []);

  // Load Facebook JS SDK
  useEffect(() => {
    if (!META_APP_ID) return;
    window.fbAsyncInit = () => {
      window.FB.init({ appId: META_APP_ID, autoLogAppEvents: true, xfbml: true, version: "v19.0" });
      console.log("FB SDK initialized, appId:", META_APP_ID);
      setSdkReady(true);
    };
    if (document.getElementById("facebook-jssdk")) { setSdkReady(true); return; }
    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  }, []);

  function launchEmbeddedSignup() {
    if (!window.FB) {
      setError("Facebook SDK not loaded yet. Please wait a moment and try again.");
      return;
    }
    setError(null);
    codeUsedRef.current = false;
    console.log("Launching FB.login with config_id:", META_CONFIG_ID, "app:", META_APP_ID);
    window.FB.login(
      (response: any) => {
        console.log("FB.login response:", JSON.stringify(response));
        if (response.authResponse?.accessToken) {
          if (codeUsedRef.current) return; // StrictMode double-fire guard
          codeUsedRef.current = true;
          setLoading(true);
          apiFetch<{ ok: boolean; phoneNumber: string }>(
            "/api/business/me/whatsapp/embedded-signup",
            { method: "POST", body: JSON.stringify({ accessToken: response.authResponse.accessToken }) }
          ).then((result) => {
            setConnected(true);
            setTokenValid(true);
            setPhoneNumber(result.phoneNumber);
            setSaved(true);
          }).catch((err: any) => {
            setError(err?.message ?? "Connection failed. Please try again.");
          }).finally(() => {
            setLoading(false);
          });
        } else {
          setError("WhatsApp connection was cancelled.");
        }
      },
      {
        config_id: META_CONFIG_ID,
        response_type: "token",
        override_default_response_type: true,
        scope: "business_management,whatsapp_business_management,whatsapp_business_messaging",
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      }
    );
  }

  async function saveManual(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/business/me/whatsapp", { method: "PUT", body: JSON.stringify({ phoneNumberId, accessToken }) });
      setSaved(true);
      setConnected(true);
      setTokenValid(true);
    } catch (err: any) {
      setError(err?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{t.whatsappTitle}</h1>
        <p className="text-gray-500 text-sm mt-1">{t.whatsappSubtitle}</p>
      </div>

      {/* Broken-connection warning (token expired/revoked) */}
      {connected && !tokenValid && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 mb-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {lang === "he" ? "חיבור הוואטסאפ נותק" : "WhatsApp connection lost"}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {lang === "he"
                ? "אישור הגישה פג תוקף או בוטל, והבוט אינו יכול לשלוח הודעות. חבר מחדש כדי להמשיך לקבל הזמנות."
                : "The access token expired or was revoked, so the bot can't send messages. Reconnect to keep receiving bookings."}
            </p>
          </div>
        </div>
      )}

      {/* Connection status */}
      <div className="flex items-center gap-2 mb-6">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
          connected && tokenValid ? "bg-green-50 text-green-700 border border-green-200"
          : connected && !tokenValid ? "bg-amber-50 text-amber-700 border border-amber-300"
          : "bg-gray-100 text-gray-500 border border-gray-200"
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            connected && tokenValid ? "bg-green-400" : connected && !tokenValid ? "bg-amber-400" : "bg-gray-300"
          }`} />
          {connected && !tokenValid ? (lang === "he" ? "נותק — נדרש חיבור מחדש" : "Disconnected — reconnect")
            : connected ? t.connected : t.notConnected}
        </span>
        {phoneNumber && <span className="text-xs text-gray-500">{phoneNumber}</span>}
        {saved && <SavedBadge text={t.saved} />}
        {connected && (
          <button
            onClick={disconnect}
            disabled={disconnecting}
            className="mr-auto text-xs text-red-500 hover:text-red-600 disabled:opacity-50 transition"
          >
            {disconnecting ? "..." : (lang === "he" ? "נתק" : "Disconnect")}
          </button>
        )}
      </div>

      {/* Embedded Signup button */}
      {META_APP_ID && !showManual && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-4">
          <div className="flex items-start gap-4 mb-5">
            <div className="w-10 h-10 rounded-xl bg-[#25D366]/10 border border-[#25D366]/20 flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.37 5.07L2 22l5.07-1.35A9.96 9.96 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm4.14 13.9c-.18.5-.88.96-1.47 1.08-.4.08-.92.14-2.68-.57-2.25-.9-3.7-3.17-3.81-3.32-.1-.14-.84-1.12-.84-2.14 0-1.01.53-1.51.72-1.72.18-.2.4-.25.53-.25h.38c.12 0 .28-.04.44.34l.62 1.5c.06.14.1.3.02.44l-.23.37-.3.35c-.1.1-.2.22-.09.43.12.2.53.87 1.14 1.41.78.7 1.45.91 1.65 1.01.2.1.31.08.43-.05l.49-.58c.12-.14.24-.1.4-.04l1.43.67c.2.1.34.14.39.23.05.1.05.55-.13 1.03z" fill="#25D366"/>
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-1">
                {lang === "he" ? "חיבור WhatsApp Business" : "Connect WhatsApp Business"}
              </h3>
              <p className="text-xs text-gray-500 leading-relaxed">
                {lang === "he"
                  ? "לחץ על הכפתור ובצע את תהליך החיבור של מטא. ייקח כ-2 דקות."
                  : "Click the button below and complete Meta's setup flow. Takes about 2 minutes."}
              </p>
            </div>
          </div>
          <button
            onClick={launchEmbeddedSignup}
            disabled={!sdkReady || loading}
            className="inline-flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20c45a] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            {loading ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.37 5.07L2 22l5.07-1.35A9.96 9.96 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2z"/></svg>
            )}
            {loading
              ? (lang === "he" ? "מתחבר..." : "Connecting...")
              : connected
              ? (lang === "he" ? "חבר מחדש" : "Reconnect WhatsApp")
              : (lang === "he" ? "חבר WhatsApp Business" : "Connect WhatsApp Business")}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {/* Manual fallback toggle */}
      <button
        onClick={() => setShowManual((v) => !v)}
        className="text-xs text-gray-400 hover:text-gray-600 transition underline underline-offset-2 mb-3"
      >
        {showManual
          ? (lang === "he" ? "← חזור לחיבור אוטומטי" : "← Back to automatic setup")
          : (lang === "he" ? "חיבור ידני (מפתחים)" : "Manual setup (developers)")}
      </button>

      {/* Manual form */}
      {showManual && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
          <form onSubmit={saveManual} className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">{t.phoneNumberId}</label>
              <input
                placeholder={t.phoneNumberIdPlaceholder}
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                required
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">{t.accessToken}</label>
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
                className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
              >
                {saving ? t.saving : t.save}
              </button>
              {saved && <SavedBadge text={t.saved} />}
            </div>
          </form>
        </div>
      )}

      <p className="text-xs text-gray-400">{t.whatsappHint}</p>
    </div>
  );
}
