"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setToken } from "../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, []);

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
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }

        .login-root {
          min-height: 100vh;
          display: grid;
          grid-template-columns: 1fr 1fr;
          background: #F0F8FB;
          direction: rtl;
          font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        }
        @media (max-width: 820px) {
          .login-root { grid-template-columns: 1fr; }
          .login-left { display: none; }
        }

        /* ── LEFT PANEL ── */
        .login-left {
          position: relative;
          background: linear-gradient(135deg, #0F172A 0%, #0D2A38 50%, #0F172A 100%);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 56px 60px;
          overflow: hidden;
        }
        .login-left::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 600px 500px at 20% 80%, rgba(27,127,160,0.08) 0%, transparent 60%),
            radial-gradient(ellipse 400px 400px at 80% 20%, rgba(27,127,160,0.12) 0%, transparent 60%);
          pointer-events: none;
        }
        .login-left-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
          background-size: 48px 48px;
          pointer-events: none;
        }

        .login-left-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          position: relative;
          z-index: 1;
        }
        .login-left-brand-name {
          font-size: 22px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.5px;
        }

        .login-left-content {
          position: relative;
          z-index: 1;
        }
        .login-left-tag {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          background: rgba(27,127,160,0.12);
          border: 1px solid rgba(27,127,160,0.2);
          border-radius: 20px;
          padding: 5px 14px;
          font-size: 12px;
          font-weight: 600;
          color: #5BB8D4;
          letter-spacing: 0.04em;
          margin-bottom: 32px;
        }
        .login-left-tag-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #5BB8D4;
          box-shadow: 0 0 6px #5BB8D4;
          animation: pulse-dot 2s ease-in-out infinite;
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }

        .login-left-headline {
          font-size: clamp(28px, 3vw, 40px);
          font-weight: 800;
          color: #fff;
          line-height: 1.2;
          letter-spacing: -1.5px;
          margin-bottom: 20px;
          text-wrap: balance;
        }
        .login-left-headline em {
          font-style: normal;
          color: #5BB8D4;
        }
        .login-left-sub {
          font-size: 15px;
          color: rgba(255,255,255,0.55);
          line-height: 1.7;
          max-width: 360px;
          margin-bottom: 44px;
        }

        .login-left-stats {
          display: flex;
          gap: 32px;
        }
        .login-left-stat {}
        .login-left-stat-n {
          font-size: 26px;
          font-weight: 800;
          color: #fff;
          letter-spacing: -1px;
          line-height: 1;
          margin-bottom: 4px;
        }
        .login-left-stat-n span { color: #5BB8D4; }
        .login-left-stat-l {
          font-size: 11px;
          color: rgba(255,255,255,0.4);
          letter-spacing: 0.04em;
        }

        .login-left-testimonial {
          position: relative;
          z-index: 1;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          padding: 22px 26px;
        }
        .login-left-quote {
          font-size: 14px;
          color: rgba(255,255,255,0.75);
          line-height: 1.7;
          margin-bottom: 16px;
        }
        .login-left-author {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .login-left-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: linear-gradient(135deg, #1B7FA0, #145F78);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 700;
          color: #000;
          flex-shrink: 0;
        }
        .login-left-author-name {
          font-size: 13px;
          font-weight: 600;
          color: #fff;
        }
        .login-left-author-role {
          font-size: 11px;
          color: rgba(255,255,255,0.4);
        }

        /* ── RIGHT PANEL ── */
        .login-right {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 32px;
          background: #F0F8FB;
        }

        .login-form-wrap {
          width: 100%;
          max-width: 400px;
          opacity: 0;
          transform: translateY(16px);
          transition: opacity 0.5s ease, transform 0.5s ease;
        }
        .login-form-wrap.show {
          opacity: 1;
          transform: none;
        }

        .login-form-logo {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 36px;
        }
        .login-form-logo-name {
          font-size: 18px;
          font-weight: 700;
          color: #1A1A2E;
          letter-spacing: -0.4px;
        }
        .login-form-logo-sub {
          font-size: 13px;
          color: #9CA3AF;
          margin-top: 1px;
        }

        .login-form-heading {
          font-size: 22px;
          font-weight: 800;
          color: #1A1A2E;
          letter-spacing: -0.8px;
          margin-bottom: 6px;
        }
        .login-form-sub {
          font-size: 14.5px;
          color: #9CA3AF;
          margin-bottom: 28px;
        }

        .login-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 14px;
        }
        .login-field label {
          font-size: 13.5px;
          font-weight: 600;
          color: #6B7280;
          letter-spacing: 0.03em;
        }
        .login-field input {
          width: 100%;
          background: #FFFFFF;
          border: 1px solid #E5E5F0;
          border-radius: 10px;
          padding: 12px 16px;
          font-size: 15px;
          color: #1A1A2E;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
          direction: ltr;
          font-family: inherit;
        }
        .login-field input::placeholder {
          color: #D1D5DB;
          direction: ltr;
        }
        .login-field input:focus {
          border-color: #1B7FA0;
          box-shadow: 0 0 0 3px rgba(27,127,160,0.12);
        }

        .login-forgot {
          display: block;
          text-align: left;
          font-size: 13px;
          color: #9CA3AF;
          text-decoration: none;
          margin-top: -6px;
          margin-bottom: 8px;
          transition: color 0.15s;
        }
        .login-forgot:hover { color: #1B7FA0; }

        .login-error {
          background: rgba(239,68,68,0.06);
          border: 1px solid rgba(239,68,68,0.2);
          border-radius: 10px;
          padding: 11px 14px;
          font-size: 13px;
          color: #DC2626;
          margin-bottom: 14px;
        }

        .login-submit {
          width: 100%;
          background: #1B7FA0;
          color: #fff;
          font-size: 14px;
          font-weight: 700;
          border: none;
          border-radius: 10px;
          padding: 14px;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
          font-family: inherit;
          letter-spacing: -0.2px;
          margin-top: 6px;
        }
        .login-submit:hover:not(:disabled) {
          background: #145F78;
          box-shadow: 0 4px 20px rgba(27,127,160,0.35);
          transform: translateY(-1px);
        }
        .login-submit:active:not(:disabled) { transform: none; }
        .login-submit:disabled { opacity: 0.5; cursor: not-allowed; }

        .login-divider {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 22px 0;
        }
        .login-divider-line {
          flex: 1;
          height: 1px;
          background: #E5E5F0;
        }
        .login-divider-text {
          font-size: 13px;
          color: #9CA3AF;
          white-space: nowrap;
        }

        .login-switch {
          text-align: center;
          font-size: 15px;
          color: #9CA3AF;
        }
        .login-switch button {
          background: none;
          border: none;
          color: #1B7FA0;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: color 0.15s;
        }
        .login-switch button:hover { color: #145F78; }

        .login-trust {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 20px;
          margin-top: 28px;
          flex-wrap: wrap;
        }
        .login-trust-item {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 13px;
          color: #6B7280;
        }
        .login-trust-icon {
          font-size: 15px;
          opacity: 0.9;
        }
      `}</style>

      <main className="login-root">
        {/* Left panel */}
        <div className="login-left">
          <div className="login-left-grid" />

          <div className="login-left-brand">
            <video src="/logo_animation.mp4" autoPlay loop muted playsInline style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 8 }} />
            <span className="login-left-brand-name">תורי</span>
          </div>

          <div className="login-left-content">
            <div className="login-left-tag">
              <span className="login-left-tag-dot" />
              בוט AI פעיל · 24/7
            </div>
            <div className="login-left-headline">
              הדשבורד שמנהל<br />
              את <em>כל התורים</em><br />
              בשבילך
            </div>
            <p className="login-left-sub">
              קבל תורים בוואטסאפ, ראה את לוח הזמנים שלך בזמן אמת,
              ותן ל-AI לטפל בכל השאר.
            </p>
            <div className="login-left-stats">
              <div className="login-left-stat">
                <div className="login-left-stat-n"><span>+</span>2,400</div>
                <div className="login-left-stat-l">עסקים פעילים</div>
              </div>
              <div className="login-left-stat">
                <div className="login-left-stat-n"><span>98</span>%</div>
                <div className="login-left-stat-l">שיעור מענה</div>
              </div>
              <div className="login-left-stat">
                <div className="login-left-stat-n"><span>4.9</span>★</div>
                <div className="login-left-stat-l">דירוג לקוחות</div>
              </div>
            </div>
          </div>

          <div className="login-left-testimonial">
            <div className="login-left-quote">
              &ldquo;מאז שהתחלתי להשתמש בתורי, הפסקתי לאבד לקוחות בגלל שלא עניתי לטלפונים. הבוט עובד גם ב-2 בלילה.&rdquo;
            </div>
            <div className="login-left-author">
              <div className="login-left-avatar">ש</div>
              <div>
                <div className="login-left-author-name">שרה לוי</div>
                <div className="login-left-author-role">מספרת שרה, תל אביב</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div className="login-right">
          <div className={`login-form-wrap ${mounted ? "show" : ""}`}>

            <div className="login-form-logo">
              <Image src="/tori_logo_transparent.png" alt="תורי" width={36} height={36} priority />
              <div>
                <div className="login-form-logo-name">תורי</div>
                <div className="login-form-logo-sub">הזמנת תורים בוואטסאפ</div>
              </div>
            </div>

            <h1 className="login-form-heading">
              {mode === "login" ? "ברוך הבא" : "יצירת חשבון חדש"}
            </h1>
            <p className="login-form-sub">
              {mode === "login"
                ? "הכנס לחשבון שלך כדי לנהל את התורים"
                : "הצטרף לאלפי עסקים שמשתמשים בתורי"}
            </p>

            <form onSubmit={submit}>
              {mode === "signup" && (
                <div className="login-field">
                  <label>שם העסק</label>
                  <input
                    placeholder="מספרה / קליניקה / סטודיו..."
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              )}
              <div className="login-field">
                <label>כתובת אימייל</label>
                <input
                  placeholder="name@example.com"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="login-field">
                <label>סיסמה</label>
                <input
                  placeholder="••••••••"
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {mode === "login" && (
                <Link href="/forgot-password" className="login-forgot">שכחת סיסמה?</Link>
              )}

              {error && <div className="login-error">{error}</div>}

              <button type="submit" disabled={loading} className="login-submit">
                {loading ? "רגע..." : mode === "login" ? "כניסה לחשבון" : "יצירת חשבון"}
              </button>
            </form>

            <div className="login-divider">
              <div className="login-divider-line" />
              <span className="login-divider-text">
                {mode === "login" ? "אין לך חשבון?" : "כבר יש לך חשבון?"}
              </span>
              <div className="login-divider-line" />
            </div>

            <div className="login-switch">
              <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); }}>
                {mode === "login" ? "הרשמה חינם →" : "כניסה לחשבון →"}
              </button>
            </div>

            <div className="login-trust">
              <div className="login-trust-item"><span className="login-trust-icon">🔒</span>SSL מאובטח</div>
              <div className="login-trust-item"><span className="login-trust-icon">🛡️</span>ללא חוזה</div>
              <div className="login-trust-item"><span className="login-trust-icon">⚡</span>פעיל תוך דקות</div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
