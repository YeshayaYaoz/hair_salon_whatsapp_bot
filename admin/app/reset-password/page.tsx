"use client";

import Image from "next/image";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "../lib/api";

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("הסיסמאות אינן תואמות"); return; }
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
      setTimeout(() => router.push("/"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה — ייתכן שהקישור פג תוקף");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return <p className="text-zinc-400 text-sm text-center">קישור לא תקין.</p>;
  }

  return done ? (
    <div className="text-center py-4">
      <div className="w-12 h-12 rounded-full bg-green-900/40 border border-green-800 flex items-center justify-center mx-auto mb-4">
        <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-white mb-2">הסיסמה אופסה!</h2>
      <p className="text-zinc-400 text-sm">מועבר לדף הכניסה…</p>
    </div>
  ) : (
    <>
      <h2 className="text-lg font-semibold mb-1 text-white">סיסמה חדשה</h2>
      <p className="text-zinc-400 text-sm mb-5">בחר סיסמה חדשה לחשבון שלך.</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          placeholder="סיסמה חדשה (8 תווים לפחות)"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="w-full"
        />
        <input
          placeholder="אימות סיסמה"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="w-full"
        />
        {error && (
          <p className="text-red-400 text-sm bg-red-950/40 border border-red-800 rounded-lg px-3 py-2">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-3 text-sm transition"
        >
          {loading ? "מאפס…" : "אפס סיסמה"}
        </button>
      </form>
      <p className="text-center text-sm text-zinc-500 mt-5">
        <Link href="/" className="text-[#5BB8D4] hover:text-[#8DD4E8] font-medium transition">
          חזור לכניסה
        </Link>
      </p>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-8 bg-zinc-950">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 animate-fade-up">
          <Image src="/tori_logo_transparent.png" alt="תורי" width={100} height={100} className="mb-2 drop-shadow-2xl" priority />
          <p className="text-zinc-400 text-sm">הזמנת תורים בוואטסאפ</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl animate-fade-up stagger-2">
          <Suspense fallback={<p className="text-zinc-400 text-sm text-center">טוען…</p>}>
            <ResetForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
