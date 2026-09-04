"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setToken, reloadAs, friendlyError } from "../lib/api";
import { useLanguage } from "../lib/LanguageContext";

export default function LoginPage() {
  const router = useRouter();
  const { lang } = useLanguage();
  const he = lang === "he";
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [signupStep, setSignupStep] = useState<1 | 2>(1); // guided 2-step signup: credentials → business
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set alongside `error` when the failure has a known one-click fix — "wrong password" often
  // really means "you never signed up", and "email taken" often means "you already have an
  // account". Rather than make people guess, offer the other mode directly.
  const [switchHint, setSwitchHint] = useState<"try-signup" | "try-login" | null>(null);
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
    setSwitchHint(null);
  }

  // Step 1 → 2: validate credentials client-side before advancing so the user doesn't fill in
  // business details only to bounce back on a bad email/short password.
  function continueToBusinessStep(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSwitchHint(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(he ? "כתובת אימייל לא תקינה" : "Invalid email address");
      return;
    }
    if (password.length < 8) {
      setError(he ? "הסיסמה חייבת להכיל לפחות 8 תווים" : "Password must be at least 8 characters");
      return;
    }
    setSignupStep(2);
  }

  async function signInWithGoogle() {
    setGoogleLoading(true);
    setError(null);
    setSwitchHint(null);
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
    setSwitchHint(null);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const body = mode === "login" ? { email, password } : { name, email, password };
      const { token } = await apiFetch<{ token: string }>(path, { method: "POST", body: JSON.stringify(body) });
      setToken(token);
      // Full load rather than router.push: signing in changes who the app is for, and anything
      // rendered from a previous session in this tab — a logged-out owner switching accounts, or
      // an admin who just left impersonation — would otherwise survive the navigation.
      reloadAs("/dashboard/analytics");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      // "Wrong password" on login is very often actually "never signed up" — and "email taken"
      // on signup is very often "already have an account". Point people at the fix instead of
      // leaving them to retype the same thing that just failed.
      if (mode === "login" && message === friendlyError("Invalid credentials")) {
        setSwitchHint("try-signup");
      } else if (mode === "signup" && message === friendlyError("Email already registered")) {
        setSwitchHint("try-login");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* .login-card starts at opacity 0 and is revealed by a `show` class set from a useEffect, so
          with JavaScript disabled the sign-in form stayed invisible forever — a blank half-page
          rather than a graceful degradation. This restores it without costing JS users the
          entrance animation. */}
      <noscript><style dangerouslySetInnerHTML={{ __html: `.login-card { opacity: 1 !important; transform: none !important; }` }} /></noscript>
      {/* dangerouslySetInnerHTML, not a text child: React escapes text children, so an apostrophe
          becomes &#x27; in the server HTML — but <style> is a raw-text element, so the browser never
          decodes it. `content: ''` then parses as invalid and the declaration is dropped entirely
          (the aurora glows below simply never render in the server paint), and the text mismatch
          fails hydration, making React throw away the whole document and re-render client-side. */}
      <style dangerouslySetInnerHTML={{ __html: `
        * { box-sizing: border-box; margin: 0; padding: 0; }

        .login-root {
          min-height: 100vh;
          display: grid;
          grid-template-columns: minmax(480px, 46%) 1fr;
          font-family: var(--font-assistant), 'Segoe UI', system-ui, -apple-system, sans-serif;
        }
        @media (max-width: 900px) {
          .login-root { grid-template-columns: 1fr; }
          /* !important: the unconditional .login-left rule further down this stylesheet has
             equal specificity and comes later in source order, so it would otherwise win over
             this media query regardless of viewport width. */
          .login-left { display: none !important; }
        }

        /* ══════════════ LEFT / DARK PANEL ══════════════ */
        .login-left {
          position: relative;
          background: linear-gradient(160deg, #081826 0%, #0D2A38 55%, #0A1F2E 100%);
          display: flex;
          flex-direction: column;
          /* Content is centered as one natural-height block rather than stretched or pinned to
             an edge — on a tall display that just means equal calm space above and below, which
             reads as a deliberate layout instead of dead space or inflated components. */
          justify-content: center;
          gap: 26px;
          padding: 48px;
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

        .login-left-top { position: relative; z-index: 1; }
        .login-demo, .login-left-stats { position: relative; z-index: 1; }
        .login-left-tag {
          display: inline-flex; align-items: center; gap: 7px;
          background: rgba(27,127,160,0.14); border: 1px solid rgba(91,184,212,0.25);
          border-radius: 20px; padding: 5px 14px;
          font-size: 13px; font-weight: 600; color: #5BB8D4; letter-spacing: 0.04em;
          margin-bottom: 16px;
          backdrop-filter: blur(4px);
        }
        .login-left-tag-dot {
          width: 6px; height: 6px; border-radius: 50%; background: #4ADE80;
          box-shadow: 0 0 8px rgba(74,222,128,0.8);
          animation: pulse-dot 2s ease-in-out infinite;
        }
        @keyframes pulse-dot { 0%,100% { opacity: 1; transform: scale(1);} 50% { opacity: 0.45; transform: scale(0.75);} }

        .login-left-headline {
          font-size: clamp(27px, 2.4vw, 36px);
          font-weight: 850; color: #fff; line-height: 1.18; letter-spacing: -1.1px;
          margin-bottom: 10px; text-wrap: balance;
        }
        .login-left-headline em { font-style: normal; color: #5BB8D4; }
        .login-left-sub {
          font-size: 15px; color: rgba(255,255,255,0.5); line-height: 1.6;
          max-width: 380px; margin-bottom: 18px;
        }

        /* live WhatsApp demo card */
        .login-demo {
          background: rgba(255,255,255,0.045);
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 18px;
          padding: 16px 20px;
          max-width: 460px;
          backdrop-filter: blur(8px);
          box-shadow: 0 24px 60px rgba(0,0,0,0.35);
          margin-bottom: 16px;
        }
        .login-demo-head {
          display: flex; align-items: center; gap: 12px;
          padding-bottom: 14px; margin-bottom: 14px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
        }
        .login-demo-ava {
          width: 42px; height: 42px; border-radius: 50%;
          background: #fff; overflow: hidden; flex-shrink: 0;
          box-shadow: 0 0 0 2px rgba(37,211,102,0.35);
          display: flex; align-items: center; justify-content: center;
        }
        .login-demo-ava img { width: 100%; height: 100%; object-fit: cover; }
        .login-demo-name { font-size: 16px; font-weight: 700; color: #fff; line-height: 1.2; }
        .login-demo-status { font-size: 13px; color: #4ADE80; margin-top: 2px; }
        .login-bubble {
          max-width: 82%; border-radius: 16px; padding: 9px 15px;
          font-size: 14.5px; line-height: 1.5; margin-bottom: 8px;
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
        .login-bubble.customer.second { animation-delay: 1.9s; }
        .login-bubble.bot.third { animation-delay: 2.55s; }
        .login-bubble .ticks { color: #5BB8D4; font-size: 10px; margin-inline-start: 6px; }
        @keyframes bubble-in { to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          .login-bubble { animation: none; opacity: 1; transform: none; }
        }

        .login-left-bottom { display: flex; flex-direction: column; gap: 14px; }
        .login-left-stats { display: flex; gap: 10px; }
        .login-left-stat {
          flex: 1;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          padding: 10px 14px;
          backdrop-filter: blur(6px);
        }
        .login-left-stat-icon { font-size: 12px; margin-bottom: 4px; opacity: 0.8; }
        .login-left-stat-n {
          font-size: 22px; font-weight: 800; color: #fff; letter-spacing: -0.8px;
          line-height: 1; margin-bottom: 3px; font-variant-numeric: tabular-nums;
        }
        .login-left-stat-n span { color: #5BB8D4; }
        .login-left-stat-l { font-size: 11.5px; color: rgba(255,255,255,0.42); letter-spacing: 0.03em; }

        /* What's waiting inside, stated as capabilities. This slot used to hold a five-star review
           from "שרה לוי, מספרת שרה, תל אביב" — complete with a verification tick — alongside stats
           claiming 2,400 active businesses and a 4.9 rating. None of that was real, and the
           landing page had already dropped its invented testimonials for exactly that reason. A
           fabricated review with a verified badge on the page where people hand over an email is
           the worst place in the product to keep one. Replaced with things the product verifiably
           does; restore a quote here when there is a real customer willing to be named. */
        .login-left-highlights {
          position: relative; z-index: 1; overflow: hidden;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          padding: 14px 18px;
          backdrop-filter: blur(6px);
          display: flex; flex-direction: column; gap: 9px;
        }
        .login-left-highlight { display: flex; align-items: flex-start; gap: 10px; }
        .login-left-highlight-tick {
          width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0; margin-top: 1px;
          background: rgba(37,211,102,0.16); border: 1px solid rgba(37,211,102,0.3);
          display: flex; align-items: center; justify-content: center;
        }
        .login-left-highlight-text { font-size: 13.5px; color: rgba(255,255,255,0.78); line-height: 1.5; }
        .login-left-highlight-text b { color: #fff; font-weight: 600; }

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
          max-width: 500px;
          background: #FFFFFF;
          border: 1px solid #E8EEF3;
          border-radius: 24px;
          padding: 32px 38px 26px;
          box-shadow:
            0 1px 2px rgba(13,42,56,0.04),
            0 12px 32px rgba(13,42,56,0.07),
            0 32px 80px rgba(13,42,56,0.08);
          opacity: 0; transform: translateY(18px);
          transition: opacity 0.55s ease, transform 0.55s ease;
        }
        .login-card.show { opacity: 1; transform: none; }
        @media (max-width: 480px) {
          /* start-aligned rather than centered: on a short viewport (small phone, or keyboard
             open) vertical centering can push the top of the card — logo, heading — off-screen
             with no way to scroll back up to it. Anchoring to the top keeps it always reachable. */
          .login-right { padding: 20px 14px; align-items: flex-start; }
          .login-card { padding: 28px 18px 22px; border-radius: 18px; }
          .login-form-brand { margin-bottom: 16px; }
          .login-form-heading { font-size: 22px; }
          .login-form-sub { margin-bottom: 20px; }
          .login-field { margin-bottom: 12px; }
          .login-trust { gap: 6px; margin-top: 18px; }
          .login-trust-item { font-size: 11px; padding: 5px 10px; }
        }
        /* Short viewports (common laptop screens, e.g. 1366x768) — the height problem, not width,
           so this keys off max-height rather than max-width. Compresses vertical rhythm on both
           panels enough that nothing needs to scroll to see the full page. */
        @media (max-height: 820px) {
          .login-right { padding: 16px 28px; }
          .login-left { padding: 18px 48px; gap: 14px; }
          .login-left-tag { margin-bottom: 8px; }
          .login-left-headline { font-size: clamp(19px, 2vw, 24px); margin-bottom: 5px; }
          .login-left-sub { margin-bottom: 8px; }
          .login-demo { padding: 12px; }
          .login-demo-head { padding-bottom: 6px; margin-bottom: 6px; }
          .login-demo-ava { width: 28px; height: 28px; }
          .login-demo-name { font-size: 12px; }
          .login-demo-status { font-size: 10px; margin-top: 0; }
          .login-bubble { padding: 5px 10px; font-size: 11px; margin-bottom: 5px; }
          .login-left-stats { margin-bottom: 0; gap: 8px; }
          .login-left-stat { padding: 7px 10px; }
          .login-left-stat-icon { margin-bottom: 2px; }
          .login-left-stat-n { font-size: 17px; margin-bottom: 1px; }
          .login-left-highlights { padding: 10px 14px; gap: 6px; }
          .login-left-highlight-text { font-size: 12px; }
          .login-card { padding: 14px 30px 10px; }
          .login-form-brand { margin-bottom: 5px; }
          .login-form-brand img { width: 36px !important; height: 36px !important; }
          .login-form-heading { font-size: 19px; margin-bottom: 2px; }
          .login-form-sub { margin-bottom: 6px; }
          .login-field { margin-bottom: 6px; }
          .login-divider { margin: 6px 0; }
          .login-trust { margin-top: 6px; }
        }
        /* Very short viewports (e.g. a maximized 1080p browser with chrome eating into the
           viewport) — drop the highlights entirely rather than keep shrinking text to
           illegibility; the demo mockup + stats carry the panel's persuasion on their own. */
        @media (max-height: 740px) {
          .login-left-highlights { display: none; }
          .login-left { gap: 10px; }
          .login-right { padding: 10px 28px; }
          .login-card { padding: 10px 30px 8px; }
          .login-form-brand { margin-bottom: 3px; }
          .login-form-brand img { width: 30px !important; height: 30px !important; }
          .login-form-heading { font-size: 17px; }
          .login-form-sub { margin-bottom: 4px; }
          .login-field { margin-bottom: 5px; }
          .login-field input { padding-top: 10px; padding-bottom: 10px; }
          .login-divider { margin: 5px 0; }
          .login-trust { margin-top: 5px; }
        }

        .login-form-brand {
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          margin-bottom: 20px;
        }
        .login-form-brand img {
          box-shadow: 0 8px 24px rgba(27,127,160,0.18);
        }
        .login-form-golden {
          font-size: 13.5px; font-weight: 700; letter-spacing: 0.02em;
          background: linear-gradient(90deg, #C9962E 0%, #A97A1F 60%, #C9962E 100%);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent; color: #A97A1F;
        }

        .login-form-heading {
          font-size: 29px; font-weight: 850; color: #0F1D2A;
          letter-spacing: -0.8px; margin-bottom: 6px; text-align: center;
        }
        /* #5C6B7A rather than the lighter #8A97A5 used elsewhere as a border/icon tint — at this
           font weight/size, #8A97A5-on-white sits under the 4.5:1 contrast ratio normal text
           needs for WCAG AA. */
        .login-form-sub { font-size: 15.5px; color: #5C6B7A; margin-bottom: 26px; text-align: center; }

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
        .login-field label { font-size: 14px; font-weight: 600; color: #5C6B7A; letter-spacing: 0.02em; }
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
          /* Inputs are always dir=ltr (even in Hebrew — email/password are Latin-script content),
             so the icon always sits on the physical left at 14px. Padding must reserve space
             there (42px), not on the right (was backwards, causing the icon to overlap the first
             couple of typed characters instead of sitting beside them). */
          padding: 13px 16px 13px 42px;
          /* 16px, not 15px: iOS Safari auto-zooms the page on focus for any input under 16px,
             which is jarring on a phone — this keeps focus from yanking the viewport around. */
          font-size: 16.5px;
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
          position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer; color: #A8B4C0;
          display: flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; padding: 0; border-radius: 8px; transition: color 0.15s;
        }
        .login-eye-btn:hover { color: #1B7FA0; }
        .login-field input.has-eye { padding-right: 42px; padding-left: 42px; }

        .login-field-hint { font-size: 12.5px; color: #9CA3AF; margin-top: 2px; }

        .login-forgot {
          display: block; text-align: start; font-size: 14px; color: #5C6B7A;
          text-decoration: none; margin-top: -4px; margin-bottom: 10px; transition: color 0.15s;
        }
        .login-forgot:hover { color: #1B7FA0; }
        .login-forgot:focus-visible, .login-eye-btn:focus-visible, .login-back-btn:focus-visible,
        @media (pointer: coarse) {
          .login-switch button { min-height: 44px; padding-inline: 0.625rem; }
        }
        .login-switch button:focus-visible {
          outline: 2px solid #1B7FA0; outline-offset: 2px; border-radius: 4px;
        }

        .login-error {
          display: flex; align-items: flex-start; gap: 8px;
          background: #FEF2F2; border: 1px solid #FECACA;
          border-radius: 10px; padding: 11px 14px;
          font-size: 14px; color: #DC2626; margin-bottom: 14px;
          line-height: 1.5;
        }
        .login-error-action {
          background: none; border: none; padding: 0; cursor: pointer;
          color: #B91C1C; font-weight: 700; font-size: 14px;
          font-family: inherit; text-decoration: underline; text-underline-offset: 2px;
        }
        .login-error-action:hover { color: #7F1D1D; }
        .login-error-action:focus-visible { outline: 2px solid #DC2626; outline-offset: 2px; border-radius: 3px; }

        .login-google-btn {
          width: 100%;
          display: flex; align-items: center; justify-content: center; gap: 10px;
          background: #fff; color: #3C4043;
          font-size: 15.5px; font-weight: 600;
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
        .login-google-btn:focus-visible { outline: 2px solid #1B7FA0; outline-offset: 2px; }

        .login-submit {
          width: 100%;
          background: linear-gradient(135deg, #1B7FA0 0%, #146A87 100%);
          color: #fff;
          font-size: 16px; font-weight: 700;
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
        .login-submit:focus-visible { outline: 2px solid #0F1D2A; outline-offset: 2px; }

        .login-back-btn {
          width: 100%; background: none; border: none; color: #9CA3AF;
          font-size: 14px; font-weight: 600; font-family: inherit; cursor: pointer;
          padding: 10px; margin-top: 4px; transition: color 0.15s;
        }
        .login-back-btn:hover { color: #1B7FA0; }

        .login-divider { display: flex; align-items: center; gap: 12px; margin: 20px 0; }
        .login-divider-line { flex: 1; height: 1px; background: #EAEFF4; }
        .login-divider-text { font-size: 13.5px; color: #5C6B7A; white-space: nowrap; }

        .login-switch { text-align: center; font-size: 15.5px; color: #5C6B7A; }
        .login-switch button {
          background: none; border: none; color: #1B7FA0;
          font-size: 15.5px; font-weight: 700; cursor: pointer;
          /* Same rule .row-action applies in globals: a text-styled button is still an action
             button, and at 23px tall this one is under the 24px floor on a phone. */
          display: inline-flex; align-items: center; justify-content: center; min-height: 32px;
          font-family: inherit; transition: color 0.15s;
        }
        .login-switch button:hover { color: #145F78; }

        .login-trust {
          display: flex; align-items: center; justify-content: center;
          gap: 8px; margin-top: 32px; flex-wrap: wrap;
        }
        .login-trust-item {
          display: flex; align-items: center; gap: 6px;
          font-size: 12.5px; font-weight: 600; color: #5C6B7A;
          background: #F3F7FA; border: 1px solid #E8EEF3;
          border-radius: 20px; padding: 5px 12px;
        }
        .login-trust-icon { font-size: 13px; }

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
      ` }} />

      <main className="login-root" dir={he ? "rtl" : "ltr"}>
        {/* Left / dark showcase panel */}
        <div className="login-left">
          <div className="login-aurora" />
          <div className="login-left-grid" />

          <div className="login-left-top">
            <div className="login-left-tag">
              <span className="login-left-tag-dot" />
              {he ? "בוט AI פעיל · 24/7" : "AI bot active · 24/7"}
            </div>
            <div className="login-left-headline">
              {he ? (
                <>הדשבורד שמנהל<br />את <em>כל התורים</em> בשבילך</>
              ) : (
                <>The dashboard that runs<br /><em>every booking</em> for you</>
              )}
            </div>
            <p className="login-left-sub">
              {he
                ? "קבלו תורים בוואטסאפ, ראו את היומן בזמן אמת, ותנו ל-AI לטפל בכל השאר."
                : "Take bookings over WhatsApp, watch the calendar update live, and let AI handle the rest."}
            </p>
          </div>

          {/* Live WhatsApp conversation mockup — the product, shown working */}
          <div className="login-demo" aria-hidden="true">
            <div className="login-demo-head">
              <div className="login-demo-ava"><img src="/tori_logo_transparent.png" alt="" /></div>
              <div>
                <div className="login-demo-name">{he ? "המספרה של שרה" : "Sarah's Salon · Tori"}</div>
                <div className="login-demo-status">{he ? "● מחובר/ת" : "● Online"}</div>
              </div>
            </div>
            <div className="login-bubble customer">{he ? "היי, אפשר תור לצבע מחר? 🙏" : "Hi, can I get a color appointment tomorrow? 🙏"}</div>
            <div className="login-bubble bot">{he ? "בטח! מחר פנוי: 10:00, 12:30 או 16:00. מה מתאים לך?" : "Sure! Tomorrow's open: 10:00, 12:30 or 16:00. What works for you?"}</div>
            <div className="login-bubble customer second">{he ? "12:30 מעולה, תודה!" : "12:30 works great, thanks!"}</div>
            <div className="login-bubble bot third">
              {he ? "✅ קבעתי לך לצבע מחר ב-12:30. נתראה!" : "✅ Booked you for color tomorrow at 12:30. See you then!"}
              <span className="ticks">✓✓</span>
            </div>
          </div>

          {/* Every number and claim in this block is something the product does, checkable against
              the product itself — not a usage statistic we'd have to have earned. */}
          <div className="login-left-bottom">
            <div className="login-left-stats">
              <div className="login-left-stat">
                <div className="login-left-stat-icon">🕒</div>
                <div className="login-left-stat-n">24<span>/7</span></div>
                <div className="login-left-stat-l">{he ? "מענה ללקוחות" : "answering customers"}</div>
              </div>
              <div className="login-left-stat">
                <div className="login-left-stat-icon">⚡</div>
                <div className="login-left-stat-n">10<span>{he ? " דק׳" : " min"}</span></div>
                <div className="login-left-stat-l">{he ? "עד שאתם באוויר" : "until you are live"}</div>
              </div>
              <div className="login-left-stat">
                <div className="login-left-stat-icon">🎁</div>
                <div className="login-left-stat-n">14<span>{he ? " יום" : " days"}</span></div>
                <div className="login-left-stat-l">{he ? "ניסיון חינם" : "free trial"}</div>
              </div>
            </div>

            <div className="login-left-highlights">
              {(he
                ? [
                    ["מבין עברית רגילה", " — הלקוח כותב איך שבא לו"],
                    ["מסנכרן לגוגל קלנדר", " — כל תור, ברגע שנקבע"],
                    ["שולח תזכורות לבד", " — לפני כל תור, בלי שתזכרו"],
                  ]
                : [
                    ["Understands natural Hebrew", " — no menus, no magic words"],
                    ["Syncs to Google Calendar", " — every booking, the moment it's made"],
                    ["Sends reminders on its own", " — before every appointment"],
                  ]
              ).map(([lead, rest]) => (
                <div key={lead} className="login-left-highlight">
                  <span className="login-left-highlight-tick" aria-hidden="true">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" strokeWidth={3.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span className="login-left-highlight-text"><b>{lead}</b>{rest}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right / form panel */}
        <div className="login-right">
          <div className={`login-card ${mounted ? "show" : ""}`}>

            {/* Brand mark — the left panel (which carries the logo) is hidden on mobile, so the
                form itself needs one for the page to feel branded on phones too. */}
            <div className="login-form-brand">
              <Image src="/tori_logo_transparent.png" alt="תורי" width={60} height={60} priority style={{ borderRadius: 15 }} />
              <div className="login-form-golden">{he ? "תור הזהב של העסק שלך" : "The golden ticket for your business"}</div>
            </div>

            {/* Signup step indicator */}
            {mode === "signup" && (
              <div className="login-steps">
                <div className={`login-step ${signupStep >= 1 ? "active" : ""}`}>
                  <span className="login-step-dot">1</span>
                  <span className="login-step-label">{he ? "פרטי חשבון" : "Account"}</span>
                </div>
                <div className={`login-step-line ${signupStep >= 2 ? "active" : ""}`} />
                <div className={`login-step ${signupStep >= 2 ? "active" : ""}`}>
                  <span className="login-step-dot">2</span>
                  <span className="login-step-label">{he ? "פרטי העסק" : "Business"}</span>
                </div>
              </div>
            )}

            <h1 className="login-form-heading">
              {mode === "login"
                ? (he ? <>ברוכים השבים <span aria-hidden="true">👋</span></> : <>Welcome back <span aria-hidden="true">👋</span></>)
                : signupStep === 1
                ? (he ? "יוצרים חשבון חדש" : "Create a new account")
                : (he ? "כמעט סיימנו!" : "Almost done!")}
            </h1>
            <p className="login-form-sub">
              {mode === "login"
                ? (he ? "מתחברים ורואים מה קורה בעסק" : "Sign in and see what's happening")
                : signupStep === 1
                ? (he ? "14 יום ניסיון — בלי כרטיס אשראי" : "14-day trial — no credit card needed")
                : (he ? "עוד פרט אחד ואתם באוויר" : "One more detail and you're live")}
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
                  {googleLoading ? (he ? "רגע..." : "One sec...") : (he ? "המשך עם Google" : "Continue with Google")}
                </button>

                <div className="login-divider">
                  <div className="login-divider-line" />
                  <span className="login-divider-text">{he ? "או עם אימייל" : "or with email"}</span>
                  <div className="login-divider-line" />
                </div>
              </>
            )}

            {/* LOGIN form, or SIGNUP step 1 (credentials) */}
            {(mode === "login" || signupStep === 1) && (
              <form onSubmit={mode === "login" ? submit : continueToBusinessStep}>
                <div className="login-field">
                  <label htmlFor="login-email">{he ? "כתובת אימייל" : "Email address"}</label>
                  <div className="login-input-wrap">
                    <span className="login-input-icon" aria-hidden="true">
                      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </span>
                    <input
                      id="login-email"
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
                  <label htmlFor="login-password">{he ? "סיסמה" : "Password"}</label>
                  <div className="login-input-wrap">
                    <span className="login-input-icon" aria-hidden="true">
                      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </span>
                    <input
                      id="login-password"
                      className="has-eye"
                      placeholder="••••••••"
                      type={showPassword ? "text" : "password"}
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    {/* Keyboard-reachable: a keyboard-only user typing a password needs to be able
                        to tab to this and reveal it, same as a mouse user can click it. */}
                    <button
                      type="button"
                      className="login-eye-btn"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={
                        showPassword
                          ? (he ? "הסתרת סיסמה" : "Hide password")
                          : (he ? "הצגת סיסמה" : "Show password")
                      }
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
                  <Link href="/forgot-password" className="login-forgot">{he ? "שכחתם סיסמה?" : "Forgot password?"}</Link>
                )}

                {error && (
                  <div className="login-error" role="alert">
                    <span aria-hidden="true">⚠️</span>
                    <span>
                      {error}
                      {switchHint === "try-signup" && (
                        <>
                          {" "}
                          <button type="button" className="login-error-action" onClick={() => switchMode("signup")}>
                            {he ? "אין לכם חשבון? הרשמו כאן" : "No account yet? Sign up here"}
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                )}

                <button type="submit" disabled={loading} className="login-submit">
                  {mode === "login"
                    ? (loading ? (he ? "רגע..." : "One sec...") : (he ? "כניסה לחשבון" : "Sign in"))
                    : (he ? "ממשיכים ←" : "Continue →")}
                </button>
              </form>
            )}

            {/* SIGNUP step 2 (business details) */}
            {mode === "signup" && signupStep === 2 && (
              <form onSubmit={submit}>
                <div className="login-field">
                  <label htmlFor="login-business-name">{he ? "שם העסק" : "Business name"}</label>
                  <div className="login-input-wrap">
                    <span className="login-input-icon" aria-hidden="true">
                      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </span>
                    <input
                      id="login-business-name"
                      placeholder={he ? "מספרה / קליניקה / סטודיו..." : "Salon / clinic / studio..."}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                      required
                      style={{ direction: he ? "rtl" : "ltr", paddingRight: 42, paddingLeft: 16 }}
                    />
                  </div>
                  <p className="login-field-hint">{he ? "ככה הבוט יציג את עצמו ללקוחות שלכם" : "This is how the bot will introduce itself to your customers"}</p>
                </div>

                {error && (
                  <div className="login-error" role="alert">
                    <span aria-hidden="true">⚠️</span>
                    <span>
                      {error}
                      {switchHint === "try-login" && (
                        <>
                          {" "}
                          <button type="button" className="login-error-action" onClick={() => switchMode("login")}>
                            {he ? "כבר יש לכם חשבון? התחברו כאן" : "Already have an account? Sign in here"}
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                )}

                <button type="submit" disabled={loading} className="login-submit">
                  {loading ? (he ? "רגע..." : "One sec...") : (he ? "יצירת חשבון וסיום 🎉" : "Create account & finish 🎉")}
                </button>
                <button type="button" className="login-back-btn" onClick={() => { setSignupStep(1); setError(null); }}>
                  {he ? "→ חזרה" : "← Back"}
                </button>
              </form>
            )}

            <div className="login-divider">
              <div className="login-divider-line" />
              <span className="login-divider-text">
                {mode === "login"
                  ? (he ? "עוד אין לכם חשבון?" : "Don't have an account yet?")
                  : (he ? "כבר יש לכם חשבון?" : "Already have an account?")}
              </span>
              <div className="login-divider-line" />
            </div>

            <div className="login-switch">
              <button onClick={() => switchMode(mode === "login" ? "signup" : "login")}>
                {mode === "login"
                  ? (he ? "נרשמים חינם ←" : "Sign up free →")
                  : (he ? "כניסה לחשבון ←" : "Sign in →")}
              </button>
            </div>

            <div className="login-trust">
              <div className="login-trust-item"><span className="login-trust-icon" aria-hidden="true">🔒</span>{he ? "SSL מאובטח" : "SSL secured"}</div>
              <div className="login-trust-item"><span className="login-trust-icon" aria-hidden="true">🛡️</span>{he ? "ללא התחייבות" : "No commitment"}</div>
              <div className="login-trust-item"><span className="login-trust-icon" aria-hidden="true">⚡</span>{he ? "באוויר תוך דקות" : "Live in minutes"}</div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
