"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { apiFetch, setToken } from "../lib/api";

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
    apiFetch<{ token: string }>("/api/auth/google/callback", {
      method: "POST",
      body: JSON.stringify({ code }),
    })
      .then(({ token }) => {
        setToken(token);
        router.replace("/dashboard/analytics");
      })
      .catch((e) => {
        setError(e.message);
        setStatus("error");
      });
  }, [params, router]);

  if (status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="text-center">
          <p className="text-red-400 mb-4">התחברות עם גוגל נכשלה: {error}</p>
          <a href="/login" className="text-[#5BB8D4] hover:text-[#8DD4E8] text-sm">
            חזור להתחברות
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-[#2A9BBF] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-zinc-400 text-sm">מתחברים עם גוגל...</p>
      </div>
    </div>
  );
}

export default function GoogleSignInCallbackPage() {
  return (
    <Suspense>
      <CallbackHandler />
    </Suspense>
  );
}
