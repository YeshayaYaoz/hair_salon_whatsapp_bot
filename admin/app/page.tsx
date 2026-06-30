"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setToken } from "./lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const body = mode === "login" ? { email, password } : { name, email, password };
      const { token } = await apiFetch<{ token: string }>(path, { method: "POST", body: JSON.stringify(body) });
      setToken(token);
      router.push("/dashboard/analytics");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / brand */}
        <div className="text-center mb-8 animate-fade-up">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 mb-4 shadow-xl shadow-violet-900/50">
            {/* Scissors + chat bubble mark */}
            <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 9l6 6M6 15l6-6m3.5-3.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm0 9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
            </svg>
          </div>
          <h1 className="font-[family-name:var(--font-karantina)] text-5xl font-bold text-white tracking-wider">תורי</h1>
          <p className="text-zinc-400 text-sm mt-1">הזמנת תורים בוואטסאפ</p>
        </div>

        {/* Card */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl animate-fade-up stagger-2">
          <h2 className="text-lg font-semibold mb-5 text-white">
            {mode === "login" ? "כניסה לחשבון" : "יצירת חשבון"}
          </h2>

          <form onSubmit={submit} className="flex flex-col gap-3">
            {mode === "signup" && (
              <input
                placeholder="שם הסלון"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full"
              />
            )}
            <input
              placeholder="כתובת אימייל"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full"
            />
            <input
              placeholder="סיסמה"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full"
            />

            {error && (
              <p className="text-red-400 text-sm bg-red-950/40 border border-red-800 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-2.5 text-sm transition"
            >
              {loading ? "רגע..." : mode === "login" ? "כניסה" : "יצירת חשבון"}
            </button>
          </form>

          <p className="text-center text-sm text-zinc-500 mt-4">
            {mode === "login" ? "אין לך חשבון?" : "כבר יש לך חשבון?"}{" "}
            <button
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
              className="text-violet-400 hover:text-violet-300 font-medium transition"
            >
              {mode === "login" ? "הרשמה" : "כניסה"}
            </button>
          </p>
        </div>
      </div>
    </main>
  );
}
