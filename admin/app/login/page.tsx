"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setToken } from "../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [signupStep, setSignupStep] = useState<1 | 2>(1); // guided 2-step signup: credentials → business
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, []);

  function switchMode(next: "login" | "signup") {
    setMode(next);
    setSignupStep(1);
    setError(null);
  }

  // Step 1 → 2: validate credentials client-side before advancing so the user doesn't fill in
  // business details only to bounce back on a bad email/short password.
  function continueToBusinessStep(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("כתובת אימייל לא תקינה");
      return;
    }
    if (password.length < 8) {
      setError("הסיסמה חייבת להכיל לפחות 8 תווים");
      return;
    }
    setSignupStep(2);
  }

  async function signInWithGoogle() {
    setGoogleLoading(true);
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/auth/google/url");
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in is unavailable");
      setGoogleLoading(false);
    }
  }

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
          grid-template-columns: minmax(480px, 46%) 1fr;
          direction: rtl;
          font-family: var(--font-heebo), 'Segoe UI', system-ui, -apple-system, sans-serif;
        }
        @media (max-width: 900px) {
          .login-root { grid-template-columns: 1fr; }
          .login-left { display: none; }
        }

        /* ══════════════ LEFT / DARK PANEL ══════════════ */
        .login-left {
          position: relative;
          background: linear-gradient(160deg, #081826 0%, #0D2A38 55%, #0A1F2E 100%);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 48px 56px;
          overflow: hidden;
        }
        /* breathing aurora glows */
        .login-aurora {
          position: absolute; inset: 0; pointer-events: none;
        }
        .login-aurora::before, .login-aurora::after {
          content: '';
          position: absolute;
          border-radius: 50%;
          filter: blur(90px);
        }
        .login-aurora::before {
          width: 480px; height: 480px;
          background: rgba(27,127,160,0.22);
          top: -140px; left: -120px;
          animation: aurora-a 14s ease-in-out infinite alternate;
        }
        .login-aurora::after {
          width: 380px; height: 380px;
          background: rgba(224,169,59,0.07);
          bottom: -120px; right: -80px;
          animation: aurora-b 18s ease-in-out infinite alternate;
        }
        @keyframes aurora-a { from { transform: translate(0,0) scale(1); } to { transform: translate(60px,40px) scale(1.15); } }
        @keyframes aurora-b { from { transform: translate(0,0) scale(1); } to { transform: translate(-50px,-30px) scale(1.1); } }
        @media (prefers-reduced-motion: reduce) {
          .login-aurora::before, .login-aurora::after { animation: none; }
        }
        .login-left-grid {
          position: absolute; inset: 0; pointer-events: none;
          background-image:
            linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
          background-size: 44px 44px;
          mask-image: radial-gradient(ellipse 90% 80% at 50% 40%, black 30%, transparent 100%);
          -webkit-mask-image: radial-gradient(ellipse 90% 80% at 50% 40%, black 30%, transparent 100%);
        }

        .login-left-brand { display: flex; align-items: center; gap: 13px; position: relative; z-index: 1; }
        .login-left-brand-name { font-size: 24px; font-weight: 800; color: #fff; letter-spacing: -0.5px; line-height: 1.1; }
        .login-left-golden {
          font-size: 12.5px; font-weight: 600; letter-spacing: 0.02em; margin-top: 3px;
          background: linear-gradient(90deg, #F5D77A 0%, #E0A93B 60%, #F5D77A 100%);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent; color: #E0A93B;
        }

        .login-left-mid { position: relative; z-index: 1; }
        .login-left-tag {
          display: inline-flex; align-items: center; gap: 7px;
          background: rgba(27,127,160,0.14); border: 1px solid rgba(91,184,212,0.25);
          border-radius: 20px; padding: 5px 14px;
          font-size: 12px; font-weight: 600; color: #5BB8D4; letter-spacing: 0.04em;
          margin-bottom: 24px;
          backdrop-filter: blur(4px);
        }
        .login-left-tag-dot {
          width: 6px; height: 6px; border-radius: 50%; background: #4ADE80;
          box-shadow: 0 0 8px rgba(74,222,128,0.8);
          animation: pulse-dot 2s ease-in-out infinite;
        }
        @keyframes pulse-dot { 0%,100% { opacity: 1; transform: scale(1);} 50% { opacity: 0.45; transform: scale(0.75);} }

        .login-left-headline {
          font-size: clamp(28px, 2.6vw, 38px);
          font-weight: 850; color: #fff; line-height: 1.18; letter-spacing: -1.3px;
          margin-bottom: 14px; text-wrap: balance;
        }
        .login-left-headline em { font-style: normal; color: #5BB8D4; }
        .login-left-sub {
          font-size: 14.5px; color: rgba(255,255,255,0.5); line-height: 1.75;
          max-width: 380px; margin-bottom: 28px;
        }

        /* live WhatsApp demo card */
        .login-demo {
          background: rgba(255,255,255,0.045);
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 18px;
          padding: 16px;
          max-width: 380px;
          backdrop-filter: blur(8px);
          box-shadow: 0 24px 60px rgba(0,0,0,0.35);
          margin-bottom: 26px;
        }
        .login-demo-head {
          display: flex; align-items: center; gap: 10px;
          padding-bottom: 12px; margin-bottom: 12px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
        }
        .login-demo-ava {
          width: 34px; height: 34px; border-radius: 50%;
          background: #fff; overflow: hidden; flex-shrink: 0;
          box-shadow: 0 0 0 2px rgba(37,211,102,0.35);
          display: flex; align-items: center; justify-content: center;
        }
        .login-demo-ava img { width: 100%; height: 100%; object-fit: cover; }
        .login-demo-name { font-size: 13px; font-weight: 700; color: #fff; line-height: 1.2; }
        .login-demo-status { font-size: 10.5px; color: #4ADE80; }
        .login-bubble {
          max-width: 82%; border-radius: 14px; padding: 9px 13px;
          font-size: 12.5px; line-height: 1.55; margin-bottom: 8px;
          opacity: 0; transform: translateY(8px);
          animation: bubble-in 0.45s ease forwards;
        }
        .login-bubble.customer {
          background: rgba(255,255,255,0.09); color: rgba(255,255,255,0.9);
          border-bottom-right-radius: 4px; margin-inline-start: auto;
          animation-delay: 0.5s;
        }
        .login-bubble.bot {
          background: rgba(37,211,102,0.14); border: 1px solid rgba(37,211,102,0.18);
          color: rgba(255,255,255,0.92);
          border-bottom-left-radius: 4px;
          animation-delay: 1.15s;
        }
        .login-bubble.bot.second { animation-delay: 1.9s; }
        .login-bubble .ticks { color: #5BB8D4; font-size: 10px; margin-inline-start: 6px; }
        @keyframes bubble-in { to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          .login-bubble { animation: none; opacity: 1; transform: none; }
        }

        .login-left-stats { display: flex; gap: 12px; }
        .login-left-stat {
          flex: 1;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          padding: 14px 16px;
          backdrop-filter: blur(6px);
        }
        .login-left-stat-n {
          font-size: 22px; font-weight: 800; color: #fff; letter-spacing: -0.8px;
          line-height: 1; margin-bottom: 5px; font-variant-numeric: tabular-nums;
        }
        .login-left-stat-n span { color: #5BB8D4; }
        .login-left-stat-l { font-size: 10.5px; color: rgba(255,255,255,0.42); letter-spacing: 0.03em; }

        .login-left-testimonial {
          position: relative; z-index: 1;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          padding: 20px 24px;
          backdrop-filter: blur(6px);
        }
        .login-left-testimonial::before {
          content: '“';
          position: absolute; top: 2px; right: 16px;
          font-size: 54px; font-weight: 800; line-height: 1;
          color: rgba(91,184,212,0.25);
          font-family: Georgia, serif;
        }
        .login-left-quote { font-size: 13.5px; color: rgba(255,255,255,0.78); line-height: 1.7; margin-bottom: 14px; padding-top: 6px; }
        .login-left-author { display: flex; align-items: center; gap: 10px; }
        .login-left-avatar {
          width: 34px; height: 34px; border-radius: 50%;
          background: linear-gradient(135deg, #1B7FA0, #145F78);
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; font-weight: 700; color: #fff; flex-shrink: 0;
          box-shadow: 0 0 0 2px rgba(91,184,212,0.25);
        }
        .login-left-author-name { font-size: 13px; font-weight: 600; color: #fff; }
        .login-left-author-role { font-size: 11px; color: rgba(255,255,255,0.4); }

        /* ══════════════ RIGHT / FORM PANEL ══════════════ */
        .login-right {
          display: flex; align-items: center; justify-content: center;
          padding: 40px 28px;
          background:
            radial-gradient(ellipse 700px 500px at 85% -10%, rgba(27,127,160,0.07) 0%, transparent 60%),
            radial-gradient(ellipse 500px 400px at 0% 110%, rgba(224,169,59,0.05) 0%, transparent 60%),
            #F6FAFC;
        }

        .login-card {
          width: 100%;
          max-width: 430px;
          background: #FFFFFF;
          border: 1px solid #E8EEF3;
          border-radius: 24px;
          padding: 40px 38px 32px;
          box-shadow:
            0 1px 2px rgba(13,42,56,0.04),
            0 12px 32px rgba(13,42,56,0.07),
            0 32px 80px rgba(13,42,56,0.08);
          opacity: 0; transform: translateY(18px);
          transition: opacity 0.55s ease, transform 0.55s ease;
        }
        .login-card.show { opacity: 1; transform: none; }
        @media (max-width: 480px) {
          .login-right { padding: 24px 16px; }
          .login-card { padding: 32px 22px 26px; border-radius: 20px; }
        }

        .login-form-brand { display: flex; justify-content: center; margin-bottom: 14px; }
        .login-form-brand img {
          box-shadow: 0 8px 24px rgba(27,127,160,0.18);
        }

        .login-form-heading {
          font-size: 26px; font-weight: 850; color: #0F1D2A;
          letter-spacing: -0.8px; margin-bottom: 6px; text-align: center;
        }
        .login-form-sub { font-size: 14.5px; color: #8A97A5; margin-bottom: 26px; text-align: center; }

        /* Signup step indicator */
        .login-steps { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; }
        .login-step { display: flex; align-items: center; gap: 8px; }
        .login-step-dot {
          width: 27px; height: 27px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 700;
          background: #EDF1F5; color: #9CA3AF;
          transition: background 0.25s, color 0.25s, box-shadow 0.25s; flex-shrink: 0;
        }
        .login-step.active .login-step-dot {
          background: linear-gradient(135deg, #1B7FA0, #146A87); color: #fff;
          box-shadow: 0 3px 10px rgba(27,127,160,0.35);
        }
        .login-step-label { font-size: 12px; font-weight: 600; color: #9CA3AF; transition: color 0.25s; white-space: nowrap; }
        .login-step.active .login-step-label { color: #0F1D2A; }
        .login-step-line { flex: 1; height: 2px; border-radius: 2px; background: #EDF1F5; transition: background 0.25s; }
        .login-step-line.active { background: #1B7FA0; }

        /* Fields with inline icons */
        .login-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
        .login-field label { font-size: 13px; font-weight: 600; color: #5C6B7A; letter-spacing: 0.02em; }
        .login-input-wrap { position: relative; }
        .login-input-icon {
          position: absolute; inset-inline-start: 14px; top: 50%; transform: translateY(-50%);
          color: #A8B4C0; pointer-events: none; display: flex;
        }
        .login-field input {
          width: 100%;
          background: #FAFCFD;
          border: 1.5px solid #E4EAF0;
          border-radius: 12px;
          padding: 13px 42px 13px 16px;
          font-size: 15px;
          color: #0F1D2A;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
          direction: ltr;
          font-family: inherit;
        }
        .login-field input::placeholder { color: #C3CCD5; direction: ltr; }
        .login-field input:focus {
          background: #fff;
          border-color: #1B7FA0;
          box-shadow: 0 0 0 4px rgba(27,127,160,0.1);
        }
        /* RTL note: inputs are dir=ltr, so the "start" icon sits on their left; padding above
           reserves space on the physical left (42px) where the icon lives. */
        .login-input-icon { inset-inline-start: auto; left: 14px; }
        .login-eye-btn {
          position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer; color: #A8B4C0;
          display: flex; padding: 4px; border-radius: 6px; transition: color 0.15s;
        }
        .login-eye-btn:hover { color: #1B7FA0; }
        .login-field input.has-eye { padding-right: 42px; padding-left: 42px; }

        .login-field-hint { font-size: 11.5px; color: #9CA3AF; margin-top: 2px; }

        .login-forgot {
          display: block; text-align: left; font-size: 13px; color: #8A97A5;
          text-decoration: none; margin-top: -4px; margin-bottom: 10px; transition: color 0.15s;
        }
        .login-forgot:hover { color: #1B7FA0; }

        .login-error {
          display: flex; align-items: center; gap: 8px;
          background: #FEF2F2; border: 1px solid #FECACA;
          border-radius: 10px; padding: 11px 14px;
          font-size: 13px; color: #DC2626; margin-bottom: 14px;
        }

        .login-google-btn {
          width: 100%;
          display: flex; align-items: center; justify-content: center; gap: 10px;
          background: #fff; color: #3C4043;
          font-size: 14.5px; font-weight: 600;
          border: 1.5px solid #E4EAF0; border-radius: 12px;
          padding: 12.5px; cursor: pointer;
          transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
          font-family: inherit;
        }
        .login-google-btn:hover:not(:disabled) {
          border-color: #C9D6E0;
          box-shadow: 0 4px 14px rgba(13,42,56,0.08);
          transform: translateY(-1px);
        }
        .login-google-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .login-submit {
          width: 100%;
          background: linear-gradient(135deg, #1B7FA0 0%, #146A87 100%);
          color: #fff;
          font-size: 15px; font-weight: 700;
          border: none; border-radius: 12px;
          padding: 14px;
          cursor: pointer;
          transition: box-shadow 0.2s, transform 0.12s, filter 0.15s;
          font-family: inherit; letter-spacing: -0.2px;
          margin-top: 6px;
          box-shadow: 0 4px 14px rgba(27,127,160,0.25);
        }
        .login-submit:hover:not(:disabled) {
          box-shadow: 0 8px 26px rgba(27,127,160,0.4);
          transform: translateY(-1.5px);
          filter: brightness(1.05);
        }
        .login-submit:active:not(:disabled) { transform: none; box-shadow: 0 3px 10px rgba(27,127,160,0.3); }
        .login-submit:disabled { opacity: 0.55; cursor: not-allowed; }

        .login-back-btn {
          width: 100%; background: none; border: none; color: #9CA3AF;
          font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer;
          padding: 10px; margin-top: 4px; transition: color 0.15s;
        }
        .login-back-btn:hover { color: #1B7FA0; }

        .login-divider { display: flex; align-items: center; gap: 12px; margin: 20px 0; }
        .login-divider-line { flex: 1; height: 1px; background: #EAEFF4; }
        .login-divider-text { font-size: 12.5px; color: #A8B4C0; white-space: nowrap; }

        .login-switch { text-align: center; font-size: 14.5px; color: #8A97A5; }
        .login-switch button {
          background: none; border: none; color: #1B7FA0;
          font-size: 14.5px; font-weight: 700; cursor: pointer;
          font-family: inherit; transition: color 0.15s;
        }
        .login-switch button:hover { color: #145F78; }

        .login-trust {
          display: flex; align-items: center; justify-content: center;
          gap: 8px; margin-top: 24px; flex-wrap: wrap;
        }
        .login-trust-item {
          display: flex; align-items: center; gap: 6px;
          font-size: 11.5px; font-weight: 600; color: #6B7A88;
          background: #F3F7FA; border: 1px solid #E8EEF3;
          border-radius: 20px; padding: 5px 12px;
        }
        .login-trust-icon { font-size: 12px; }

        /* staggered entrance for form children */
        .login-card.show > * { animation: form-item-in 0.5s ease backwards; }
        .login-card.show > *:nth-child(1) { animation-delay: 0.05s; }
        .login-card.show > *:nth-child(2) { animation-delay: 0.1s; }
        .login-card.show > *:nth-child(3) { animation-delay: 0.15s; }
        .login-card.show > *:nth-child(4) { animation-delay: 0.2s; }
        .login-card.show > *:nth-child(5) { animation-delay: 0.25s; }
        .login-card.show > *:nth-child(6) { animation-delay: 0.3s; }
        .login-card.show > *:nth-child(7) { animation-delay: 0.35s; }
        .login-card.show > *:nth-child(8) { animation-delay: 0.4s; }
        @keyframes form-item-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          .login-card, .login-card.show > * { animation: none; transition: none; opacity: 1; transform: none; }
        }
      `}</style>

      <main className="login-root">
        {/* Left / dark showcase panel */}
        <div className="login-left">
          <div className="login-aurora" />
          <div className="login-left-grid" />

          <div style={{ position: "relative", zIndex: 1 }}>
            <div className="login-left-brand">
              <Image src="/tori_logo_transparent.png" alt="תורי" width={52} height={52} style={{ flexShrink: 0, borderRadius: 13 }} />
              <div>
                <div className="login-left-brand-name">תורי</div>
                <div className="login-left-golden">תור הזהב של העסק שלך</div>
              </div>
            </div>
          </div>

          <div className="login-left-mid">
            <div className="login-left-tag">
              <span className="login-left-tag-dot" />
              בוט AI פעיל · 24/7
            </div>
            <div className="login-left-headline">
              הדשבורד שמנהל<br />
              את <em>כל התורים</em> בשבילך
            </div>
            <p className="login-left-sub">
              קבלו תורים בוואטסאפ, ראו את היומן בזמן אמת, ותנו ל-AI לטפל בכל השאר.
            </p>

            {/* Live WhatsApp conversation mockup — the product, shown working */}
            <div className="login-demo" aria-hidden="true">
              <div className="login-demo-head">
                <div className="login-demo-ava"><img src="/tori_logo_transparent.png" alt="" /></div>
                <div>
                  <div className="login-demo-name">מספרת שרה · תורי</div>
                  <div className="login-demo-status">● מחובר/ת</div>
                </div>
              </div>
              <div className="login-bubble customer">היי, אפשר תור לצבע מחר? 🙏</div>
              <div className="login-bubble bot">בטח! מחר פנוי: 10:00, 12:30 או 16:00. מה מתאים לך?</div>
              <div className="login-bubble bot second">✅ קבעתי לך לצבע מחר ב-12:30. נתראה!<span className="ticks">✓✓</span></div>
            </div>

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
              מאז שהתחלתי להשתמש בתורי, הפסקתי לאבד לקוחות בגלל שלא עניתי לטלפונים. הבוט עובד גם ב-2 בלילה.
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

        {/* Right / form panel */}
        <div className="login-right">
          <div className={`login-card ${mounted ? "show" : ""}`}>

            {/* Brand mark — the left panel (which carries the logo) is hidden on mobile, so the
                form itself needs one for the page to feel branded on phones too. */}
            <div className="login-form-brand">
              <Image src="/tori_logo_transparent.png" alt="תורי" width={60} height={60} style={{ borderRadius: 15 }} />
            </div>

            {/* Signup step indicator */}
            {mode === "signup" && (
              <div className="login-steps">
                <div className={`login-step ${signupStep >= 1 ? "active" : ""}`}>
                  <span className="login-step-dot">1</span>
                  <span className="login-step-label">פרטי חשבון</span>
                </div>
                <div className={`login-step-line ${signupStep >= 2 ? "active" : ""}`} />
                <div className={`login-step ${signupStep >= 2 ? "active" : ""}`}>
                  <span className="login-step-dot">2</span>
                  <span className="login-step-label">פרטי העסק</span>
                </div>
              </div>
            )}

            <h1 className="login-form-heading">
              {mode === "login" ? "ברוכים השבים 👋" : signupStep === 1 ? "יוצרים חשבון חדש" : "כמעט סיימנו!"}
            </h1>
            <p className="login-form-sub">
              {mode === "login"
                ? "מתחברים ורואים מה קורה בעסק"
                : signupStep === 1
                ? "מצטרפים לאלפי עסקים שכבר עובדים עם תורי"
                : "עוד פרט אחד ואתם באוויר"}
            </p>

            {/* Google + credentials only on login, or on signup step 1 */}
            {!(mode === "signup" && signupStep === 2) && (
              <>
                <button
                  type="button"
                  onClick={signInWithGoogle}
                  disabled={googleLoading}
                  className="login-google-btn"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.54 5.54 0 01-2.4 3.63v3h3.89c2.27-2.09 3.56-5.17 3.56-8.82z"/>
                    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.89-3.02c-1.08.72-2.46 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.94H1.28v3.11A11.998 11.998 0 0012 24z"/>
                    <path fill="#FBBC05" d="M5.29 14.29A7.2 7.2 0 014.9 12c0-.8.14-1.57.39-2.29V6.6H1.28A11.998 11.998 0 000 12c0 1.94.46 3.77 1.28 5.4l4.01-3.11z"/>
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.28 6.6l4.01 3.11C6.23 6.86 8.88 4.75 12 4.75z"/>
                  </svg>
                  {googleLoading ? "רגע..." : "המשך עם Google"}
                </button>

                <div className="login-divider">
                  <div className="login-divider-line" />
                  <span className="login-divider-text">או עם אימייל</span>
                  <div className="login-divider-line" />
                </div>
              </>
            )}

            {/* LOGIN form, or SIGNUP step 1 (credentials) */}
            {(mode === "login" || signupStep === 1) && (
              <form onSubmit={mode === "login" ? submit : continueToBusinessStep}>
                <div className="login-field">
                  <label>כתובת אימייל</label>
                  <div className="login-input-wrap">
                    <span className="login-input-icon">
                      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </span>
                    <input
                      placeholder="name@example.com"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="login-field">
                  <label>סיסמה</label>
                  <div className="login-input-wrap">
                    <span className="login-input-icon">
                      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </span>
                    <input
                      className="has-eye"
                      placeholder="••••••••"
                      type={showPassword ? "text" : "password"}
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="login-eye-btn"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "הסתרת סיסמה" : "הצגת סיסמה"}
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {mode === "login" && (
                  <Link href="/forgot-password" className="login-forgot">שכחתם סיסמה?</Link>
                )}

                {error && <div className="login-error">⚠️ {error}</div>}

                <button type="submit" disabled={loading} className="login-submit">
                  {mode === "login" ? (loading ? "רגע..." : "כניסה לחשבון") : "ממשיכים ←"}
                </button>
              </form>
            )}

            {/* SIGNUP step 2 (business details) */}
            {mode === "signup" && signupStep === 2 && (
              <form onSubmit={submit}>
                <div className="login-field">
                  <label>שם העסק</label>
                  <div className="login-input-wrap">
                    <span className="login-input-icon">
                      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </span>
                    <input
                      placeholder="מספרה / קליניקה / סטודיו..."
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                      required
                      style={{ direction: "rtl", paddingRight: 42, paddingLeft: 16 }}
                    />
                  </div>
                  <p className="login-field-hint">ככה הבוט יציג את עצמו ללקוחות שלכם</p>
                </div>

                {error && <div className="login-error">⚠️ {error}</div>}

                <button type="submit" disabled={loading} className="login-submit">
                  {loading ? "רגע..." : "יצירת חשבון וסיום 🎉"}
                </button>
                <button type="button" className="login-back-btn" onClick={() => { setSignupStep(1); setError(null); }}>
                  → חזרה
                </button>
              </form>
            )}

            <div className="login-divider">
              <div className="login-divider-line" />
              <span className="login-divider-text">
                {mode === "login" ? "עוד אין לכם חשבון?" : "כבר יש לכם חשבון?"}
              </span>
              <div className="login-divider-line" />
            </div>

            <div className="login-switch">
              <button onClick={() => switchMode(mode === "login" ? "signup" : "login")}>
                {mode === "login" ? "נרשמים חינם ←" : "כניסה לחשבון ←"}
              </button>
            </div>

            <div className="login-trust">
              <div className="login-trust-item"><span className="login-trust-icon">🔒</span>SSL מאובטח</div>
              <div className="login-trust-item"><span className="login-trust-icon">🛡️</span>ללא התחייבות</div>
              <div className="login-trust-item"><span className="login-trust-icon">⚡</span>באוויר תוך דקות</div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
