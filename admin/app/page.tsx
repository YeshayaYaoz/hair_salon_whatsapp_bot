"use client";

import Image from "next/image";
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
    <main className="min-h-screen flex items-center justify-center px-4 py-8 bg-zinc-950">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8 animate-fade-up">
          <Image
            src="/tori-logo.png"
            alt="תורי"
            width={120}
            height={120}
            className="mb-2 drop-shadow-2xl"
            priority
          />
          <p className="text-zinc-400 text-sm">הזמנת תורים בוואטסאפ</p>
        </div>

        {/* Card */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl animate-fade-up stagger-2">
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
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full"
            />
            <input
              placeholder="סיסמה"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
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
              className="mt-1 w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-3 text-sm transition"
            >
              {loading ? "רגע..." : mode === "login" ? "כניסה" : "יצירת חשבון"}
            </button>
          </form>

          <p className="text-center text-sm text-zinc-500 mt-5">
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
