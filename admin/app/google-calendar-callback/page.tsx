"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { apiFetch } from "../lib/api";

function CallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const code = params.get("code");
    const err = params.get("error");
    if (err || !code) {
      setError(err ?? "No code returned");
      setStatus("error");
      return;
    }
    apiFetch("/api/business/google-calendar/callback", {
      method: "POST",
      body: JSON.stringify({ code }),
    })
      .then(() => router.replace("/dashboard/settings?gcal=connected"))
      .catch((e) => {
        setError(e.message);
        setStatus("error");
      });
  }, [params, router]);

  if (status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="text-center">
          <p className="text-red-400 mb-4">חיבור Google Calendar נכשל: {error}</p>
          <a href="/dashboard/settings" className="text-violet-400 hover:text-violet-300 text-sm">
            חזור להגדרות
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-zinc-400 text-sm">מחבר את גוגל קלנדר...</p>
      </div>
    </div>
  );
}

export default function GoogleCalendarCallbackPage() {
  return (
    <Suspense>
      <CallbackHandler />
    </Suspense>
  );
}
