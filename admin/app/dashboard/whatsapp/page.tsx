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

// Meta recommends a square ~640x640 profile picture — resizing/compressing client-side before
// upload keeps the request small (server body limit is 6mb, but there's no reason to send a
// multi-megabyte phone photo when 640px is all that's ever displayed) and avoids a round trip
// just to reject an oversized file.
const PROFILE_PICTURE_MAX_DIMENSION = 640;

function resizeImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, PROFILE_PICTURE_MAX_DIMENSION / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas not supported"));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read image file"));
    };
    img.src = objectUrl;
  });
}

function WhatsAppLogoSection() {
  const { lang } = useLanguage();
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-choosing the same file consecutively
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(lang === "he" ? "יש לבחור קובץ תמונה" : "Please choose an image file");
      return;
    }
    setError(null);
    setSaved(false);
    setUploading(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setPreview(dataUrl);
      await apiFetch("/api/business/me/whatsapp/profile-picture", {
        method: "POST",
        body: JSON.stringify({ imageBase64: dataUrl }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : lang === "he" ? "ההעלאה נכשלה" : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">
        {lang === "he" ? "תמונת פרופיל בוואטסאפ" : "WhatsApp profile picture"}
      </h3>
      <p className="text-xs text-gray-500 leading-relaxed max-w-md mb-4">
        {lang === "he"
          ? "התמונה שהלקוחות שלך רואים ליד הודעות הבוט. מומלץ תמונה מרובעת וברורה (לוגו העסק)."
          : "The picture your customers see next to the bot's messages. A clear, square image (your business logo) works best."}
      </p>
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-gray-100 border border-gray-200 overflow-hidden flex-shrink-0 flex items-center justify-center">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-gray-300 text-2xl">📷</span>
          )}
        </div>
        <div>
          <label className="inline-block cursor-pointer bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
            {uploading ? (lang === "he" ? "מעלה..." : "Uploading...") : lang === "he" ? "העלאת תמונה" : "Upload image"}
            <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={uploading} onChange={onFileChosen} />
          </label>
          {saved && <span className="ms-3"><SavedBadge text={lang === "he" ? "נשמר" : "Saved"} /></span>}
        </div>
      </div>
      {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
    </div>
  );
}

// Sanitize before use: a Facebook App ID must be a bare numeric string. The #1 cause of Meta's
// "Invalid App ID" error here is the Vercel env var being pasted with surrounding quotes or a
// trailing newline/space (e.g. `"1556761279502082"` or `1556761279502082\n`) — strip those, and
// any stray non-digit characters, so a slightly-mispasted value still works instead of hard-failing.
const RAW_META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || "1556761279502082";
const META_APP_ID = RAW_META_APP_ID.replace(/[^0-9]/g, "");
// This must be the config_id shown on the WhatsApp use case's own "Embedded Signup Builder" page
// (App Dashboard > WhatsApp use case > Become a Partner > Embedded Signup Builder) — NOT a generic
// Facebook Login for Business configuration. Using the wrong config_id here is what caused every
// code exchange to fail with a misleading "redirect_uri is identical" error (Meta error_subcode
// 36008) no matter what redirect_uri was set to: the code itself was never valid for this flow.
const META_CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID || "1013901801388198";

export default function WhatsAppPage() {
  const { t, lang } = useLanguage();
  const [connected, setConnected] = useState(false);
  const [tokenValid, setTokenValid] = useState(true);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const codeUsedRef = useRef(false);
  // Meta sends the WABA + phone number IDs via postMessage during the Embedded Signup flow
  // (the "WA_EMBEDDED_SIGNUP" event) — this is the documented, reliable source for them. Trying
  // to reconstruct them afterward via Graph API (me/businesses, debug_token scopes) is what broke
  // before: those paths depend on permissions/scopes the login config doesn't always grant.
  const signupDataRef = useRef<{ wabaId?: string; phoneNumberId?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateResults, setTemplateResults] = useState<{ name: string; submitted: boolean; status?: string; error?: string }[] | null>(null);

  async function createTemplates() {
    setTemplatesLoading(true);
    setTemplateResults(null);
    setError(null);
    try {
      const { results } = await apiFetch<{ results: { name: string; submitted: boolean; status?: string; error?: string }[] }>(
        "/api/business/me/whatsapp/create-templates",
        { method: "POST" }
      );
      setTemplateResults(results);
    } catch (err: any) {
      setError(err?.message ?? "Failed to submit templates");
    } finally {
      setTemplatesLoading(false);
    }
  }

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

  // Listen for Meta's Embedded Signup postMessage — carries waba_id/phone_number_id directly,
  // sent while the signup popup is open (independent of the FB.login() callback/access token).
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!event.origin.endsWith("facebook.com")) return;
      let data: any;
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return; // not a JSON message we care about
      }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      console.log("[whatsapp] WA_EMBEDDED_SIGNUP event:", data.event, data.data);
      if (data.event === "FINISH" || data.event === "FINISH_ONLY_WABA") {
        signupDataRef.current = {
          wabaId: data.data?.waba_id ?? signupDataRef.current.wabaId,
          phoneNumberId: data.data?.phone_number_id ?? signupDataRef.current.phoneNumberId,
        };
      } else if (data.event === "ERROR") {
        setError(data.data?.error_message ?? "WhatsApp connection failed during setup.");
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Load Facebook JS SDK
  useEffect(() => {
    if (!META_APP_ID) return;
    if (RAW_META_APP_ID !== META_APP_ID) {
      console.warn(
        `NEXT_PUBLIC_META_APP_ID contained non-digit characters and was cleaned: ` +
        `${JSON.stringify(RAW_META_APP_ID)} → ${JSON.stringify(META_APP_ID)}. ` +
        `Fix the value in Vercel so it's a bare number with no quotes or whitespace.`
      );
    }
    window.fbAsyncInit = () => {
      window.FB.init({ appId: META_APP_ID, autoLogAppEvents: true, xfbml: true, version: "v23.0" });
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
    signupDataRef.current = {}; // clear any IDs left over from a previous attempt
    console.log("Launching FB.login with config_id:", META_CONFIG_ID, "app:", META_APP_ID);
    window.FB.login(
      (response: any) => {
        console.log("FB.login response:", JSON.stringify(response));
        // This config_id returns the code inside the signed_request JWT's payload rather than as
        // authResponse.code directly (confirmed live — authResponse only has accessToken/userID at
        // the top level). The payload segment is just base64url JSON, no signature verification
        // needed here since we're only extracting a value we hand off to Meta's own server-side
        // exchange right after — if it were tampered with, that exchange would simply fail.
        let code = response.authResponse?.code;
        if (!code && response.authResponse?.signedRequest) {
          try {
            const payload = response.authResponse.signedRequest.split(".")[1];
            const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
            code = JSON.parse(json)?.code;
          } catch {
            // fall through — code stays undefined, handled below
          }
        }
        if (code) {
          if (codeUsedRef.current) return; // StrictMode double-fire guard
          codeUsedRef.current = true;
          setLoading(true);
          apiFetch<{ ok: boolean; phoneNumber: string }>(
            "/api/business/me/whatsapp/embedded-signup",
            {
              method: "POST",
              body: JSON.stringify({
                code,
                wabaId: signupDataRef.current.wabaId,
                phoneNumberId: signupDataRef.current.phoneNumberId,
              }),
            }
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
        // Meta's currently documented WhatsApp Embedded Signup flow requires response_type: "code"
        // — the older implicit "token" flow silently falls back to a plain Facebook login instead
        // of routing through the WABA/phone-number selection UI (no WA_EMBEDDED_SIGNUP postMessage,
        // authResponse.userID stays null). The resulting code is exchanged server-side (needs the
        // app secret) for a real access token — see exchangeCodeForAccessToken in businessRoutes.ts.
        response_type: "code",
        override_default_response_type: true,
        // No redirect_uri: Meta's own generated Embedded Signup link for this config_id doesn't
        // include one either — the earlier redirect_uri debugging was chasing a misleading error
        // message; the real problem was an unrelated config_id (see the constant above).
        // No `scope` here — with config_id-based Embedded Signup, permissions come from the login
        // configuration itself (set in Meta App Dashboard → Facebook Login → Configurations), and
        // passing an explicit scope alongside config_id is invalid (Meta logs "Invalid Scopes" and
        // ignores it for end users, but it's a real misconfiguration worth not shipping).
        // NOT extras.version: "v4" — that switches Meta's response shape to embed the code inside
        // a signed_request JWT instead of authResponse.code directly (confirmed live: with v4 the
        // callback returned a plain accessToken/userID with no top-level code, which the handler
        // below doesn't parse). sessionInfoVersion "3" is what keeps the code in authResponse.code.
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

      {/* Message templates — needed to reach customers outside the 24h reply window */}
      {connected && tokenValid && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-1">
                {lang === "he" ? "תבניות הודעות לתזכורות וביקורות" : "Reminder & review message templates"}
              </h3>
              <p className="text-xs text-gray-500 leading-relaxed max-w-md">
                {lang === "he"
                  ? "וואטסאפ מאפשר לשלוח הודעה חופשית רק אם הלקוח כתב ב-24 השעות האחרונות. כדי שתזכורות תורים ובקשות ביקורת יגיעו גם מעבר לזה, יש לאשר תבניות הודעה מול מטא. לחיצה כאן שולחת אותן לאישור (עד כ-24 שעות)."
                  : "WhatsApp only allows free-form messages within 24h of the customer's last reply. To reach customers beyond that for reminders/reviews, message templates must be approved by Meta. This submits them for approval (can take up to ~24h)."}
              </p>
            </div>
            <button
              onClick={createTemplates}
              disabled={templatesLoading}
              className="bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 text-sm font-semibold px-4 py-2 rounded-lg transition whitespace-nowrap"
            >
              {templatesLoading ? (lang === "he" ? "שולח..." : "Submitting...") : (lang === "he" ? "שלח תבניות לאישור" : "Submit templates")}
            </button>
          </div>
          {templateResults && (
            <div className="mt-4 flex flex-col gap-1.5">
              {templateResults.map((r) => (
                <div key={r.name} className="flex items-center gap-2 text-xs">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.submitted ? "bg-green-400" : "bg-red-400"}`} />
                  <span className="font-mono text-gray-600" dir="ltr">{r.name}</span>
                  <span className={r.submitted ? "text-green-700" : "text-red-600"}>
                    {r.submitted
                      ? r.status === "EXISTING"
                        ? (lang === "he" ? "כבר קיימת" : "already exists")
                        : (lang === "he" ? `נשלחה (${r.status ?? "PENDING"})` : `submitted (${r.status ?? "PENDING"})`)
                      : r.error}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Profile picture */}
      {connected && tokenValid && <WhatsAppLogoSection />}

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
