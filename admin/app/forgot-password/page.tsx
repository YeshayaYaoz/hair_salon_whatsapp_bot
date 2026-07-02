"use client";

import Image from "next/image";
import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "../lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-8 bg-zinc-950">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 animate-fade-up">
          <Image src="/tori-logo-black.png" alt="תורי" width={100} height={100} className="mb-2 drop-shadow-2xl" priority />
          <p className="text-zinc-400 text-sm">הזמנת תורים בוואטסאפ</p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl animate-fade-up stagger-2">
          {sent ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-green-900/40 border border-green-800 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-white mb-2">בדוק את המייל שלך</h2>
              <p className="text-zinc-400 text-sm mb-6">שלחנו קישור לאיפוס סיסמה אם הכתובת קיימת במערכת.</p>
              <Link href="/" className="text-violet-400 hover:text-violet-300 text-sm font-medium transition">
                חזור לכניסה
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold mb-1 text-white">שכחת סיסמה?</h2>
              <p className="text-zinc-400 text-sm mb-5">נשלח לך קישור לאיפוס לכתובת המייל שלך.</p>
              <form onSubmit={submit} className="flex flex-col gap-3">
                {error && (
                  <p className="text-red-400 text-sm bg-red-950/40 border border-red-800 rounded-lg px-3 py-2">{error}</p>
                )}
                <input
                  placeholder="כתובת אימייל"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-3 text-sm transition"
                >
                  {loading ? "שולח…" : "שלח קישור לאיפוס"}
                </button>
              </form>
              <p className="text-center text-sm text-zinc-500 mt-5">
                <Link href="/" className="text-violet-400 hover:text-violet-300 font-medium transition">
                  חזור לכניסה
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
