"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "../lib/api";
import { useLanguage } from "../lib/LanguageContext";

type State = "verifying" | "ok" | "error";

function VerifyEmailInner() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>("verifying");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage(he ? "חסר קוד אימות בקישור." : "The link is missing its verification code.");
      return;
    }
    apiFetch("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) })
      .then(() => setState("ok"))
      .catch((err) => {
        setState("error");
        setMessage(err instanceof Error ? err.message : he ? "האימות נכשל." : "Verification failed.");
      });
    // Intentionally runs once: re-firing on a language change would re-POST a single-use token,
    // which the server would then correctly reject as already consumed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <main
      dir={he ? "rtl" : "ltr"}
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "#F6FAFC" }}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl p-8 text-center"
        style={{ border: "1px solid #E8EEF3", boxShadow: "0 12px 32px rgba(13,42,56,0.07)" }}
      >
        <Image
          src="/tori_logo_transparent.png"
          alt="תורי-אונליין"
          width={56}
          height={56}
          style={{ borderRadius: 14, margin: "0 auto 20px" }}
        />

        {state === "verifying" && (
          <>
            <h1 className="text-lg font-bold text-gray-900 mb-1">{he ? "מאמת…" : "Verifying…"}</h1>
            <p className="text-sm text-gray-600">{he ? "רק רגע" : "One moment"}</p>
          </>
        )}

        {state === "ok" && (
          <>
            <div
              className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl"
              style={{ background: "#DCFCE7", color: "#15803D" }}
              aria-hidden
            >
              ✓
            </div>
            <h1 className="text-lg font-bold text-gray-900 mb-1">
              {he ? "האימייל אומת" : "Email verified"}
            </h1>
            <p className="text-sm text-gray-600 mb-6">
              {he
                ? "מעכשיו נוכל לשלוח לך התראות והודעות חשובות על החשבון."
                : "We can now send you alerts and important account notices."}
            </p>
            <Link
              href="/dashboard/analytics"
              className="inline-block bg-[#1B7FA0] hover:bg-[#2A9BBF] text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
            >
              {he ? "כניסה לדשבורד" : "Go to dashboard"}
            </Link>
          </>
        )}

        {state === "error" && (
          <>
            <div
              className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl"
              style={{ background: "#FEE2E2", color: "#B91C1C" }}
              aria-hidden
            >
              !
            </div>
            <h1 className="text-lg font-bold text-gray-900 mb-1">{he ? "האימות נכשל" : "Verification failed"}</h1>
            <p className="text-sm text-gray-600 mb-6">{message}</p>
            <p className="text-xs text-gray-600 mb-4">
              {he
                ? "אפשר לשלוח קישור אימות חדש מעמוד ההגדרות."
                : "You can send a fresh verification link from the settings page."}
            </p>
            <Link
              href="/dashboard/settings"
              className="inline-block bg-[#1B7FA0] hover:bg-[#2A9BBF] text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
            >
              {he ? "לעמוד ההגדרות" : "Go to settings"}
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  // useSearchParams needs a Suspense boundary, or the whole route opts out of static rendering.
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}
