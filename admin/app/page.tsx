"use client";

import { useEffect, useRef } from "react";

export default function LandingPage() {
  const tiltEl = useRef<HTMLDivElement>(null);

  // 3D scroll tilt — product preview tilts flat as it enters view
  useEffect(() => {
    const el = tiltEl.current;
    if (!el) return;
    function tick() {
      const rect = el!.getBoundingClientRect();
      const vh = window.innerHeight;
      const start = vh * 0.95;
      const end = -el!.offsetHeight * 0.15;
      let p = (start - rect.top) / (start - end);
      p = Math.max(0, Math.min(1, p));
      const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p; // ease-in-out
      const rx = 28 * (1 - ease);
      const sc = 0.88 + 0.12 * ease;
      const op = 0.55 + 0.45 * ease;
      el!.style.transform = `perspective(1500px) rotateX(${rx}deg) scale(${sc})`;
      el!.style.opacity = String(op);
    }
    window.addEventListener("scroll", tick, { passive: true });
    tick();
    return () => window.removeEventListener("scroll", tick);
  }, []);

  // Scroll reveal
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) (e.target as HTMLElement).classList.add("in"); }),
      { threshold: 0.08 }
    );
    document.querySelectorAll(".reveal").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  // Feature card hover 3D tilt
  useEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>(".lp-feat");
    const move = (e: MouseEvent) => {
      const c = e.currentTarget as HTMLElement;
      const r = c.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * 14;
      const y = ((e.clientY - r.top) / r.height - 0.5) * 14;
      c.style.transform = `perspective(700px) rotateX(${-y}deg) rotateY(${x}deg) translateZ(12px)`;
    };
    const leave = (e: MouseEvent) => {
      (e.currentTarget as HTMLElement).style.transform = "";
    };
    cards.forEach((c) => { c.addEventListener("mousemove", move); c.addEventListener("mouseleave", leave); });
    return () => cards.forEach((c) => { c.removeEventListener("mousemove", move); c.removeEventListener("mouseleave", leave); });
  }, []);

  // Scroll progress bar
  useEffect(() => {
    const bar = document.getElementById("scroll-bar");
    if (!bar) return;
    const tick = () => {
      const pct = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight);
      bar.style.width = `${Math.min(pct * 100, 100)}%`;
    };
    window.addEventListener("scroll", tick, { passive: true });
    return () => window.removeEventListener("scroll", tick);
  }, []);

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .lp {
          background: #fff;
          color: #111;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
          direction: rtl;
          -webkit-font-smoothing: antialiased;
          overflow-x: hidden;
        }

        /* PROGRESS */
        #scroll-bar {
          position: fixed;
          top: 0; left: 0;
          height: 2px;
          background: #25D366;
          z-index: 9999;
          width: 0%;
          transition: width 0.05s linear;
        }

        /* NAV */
        .lp-nav {
          position: fixed; top: 0; left: 0; right: 0; z-index: 200;
          height: 62px;
          background: rgba(255,255,255,0.88);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-bottom: 1px solid rgba(0,0,0,0.07);
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 44px;
        }
        .lp-nav-logo {
          display: flex; align-items: center; gap: 10px; text-decoration: none;
          animation: fadeDown 0.5s ease 0.1s both;
        }
        .lp-nav-logo img { width: 30px; height: 30px; border-radius: 7px; }
        .lp-nav-logo span { font-size: 16px; font-weight: 700; color: #111; letter-spacing: -0.3px; }
        .lp-nav-links {
          display: flex; align-items: center; gap: 4px;
          animation: fadeDown 0.5s ease 0.15s both;
        }
        .lp-nav-link {
          font-size: 13px; font-weight: 500; color: #555;
          text-decoration: none; padding: 7px 14px; border-radius: 7px;
          transition: background 0.15s, color 0.15s;
        }
        .lp-nav-link:hover { background: #F5F5F5; color: #111; }
        .lp-nav-cta {
          font-size: 13px; font-weight: 600; color: #fff;
          background: #111; text-decoration: none;
          padding: 8px 18px; border-radius: 8px;
          transition: opacity 0.15s, transform 0.15s;
          animation: fadeDown 0.5s ease 0.2s both;
        }
        .lp-nav-cta:hover { opacity: 0.8; transform: translateY(-1px); }

        /* HERO */
        .lp-hero {
          min-height: 100vh;
          padding-top: 62px;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          text-align: center;
          padding-left: 24px; padding-right: 24px;
          background: #fff;
          position: relative;
        }
        .lp-hero::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 200px;
          background: linear-gradient(to bottom, transparent, #F8F8F8);
          pointer-events: none;
        }
        .lp-kicker {
          display: inline-flex; align-items: center; gap: 7px;
          background: #F0FFF4; border: 1px solid #BBF7D0;
          color: #15803D; font-size: 12px; font-weight: 600;
          padding: 5px 14px; border-radius: 20px;
          margin-bottom: 32px;
          animation: fadeUp 0.6s ease 0.2s both;
        }
        .lp-kicker-dot { width: 6px; height: 6px; border-radius: 50%; background: #25D366; }
        .lp-h1 {
          font-size: clamp(42px, 6.5vw, 80px);
          font-weight: 800;
          line-height: 1.04;
          letter-spacing: -3px;
          color: #0A0A0A;
          max-width: 820px;
          margin: 0 auto 22px;
          animation: fadeUp 0.7s ease 0.3s both;
        }
        .lp-h1 .green { color: #25D366; }
        .lp-hero-sub {
          font-size: clamp(16px, 1.8vw, 19px);
          color: #666;
          line-height: 1.75;
          max-width: 500px;
          margin: 0 auto 40px;
          animation: fadeUp 0.7s ease 0.4s both;
          font-weight: 400;
        }
        .lp-hero-ctas {
          display: flex; align-items: center; gap: 12px;
          justify-content: center; flex-wrap: wrap;
          margin-bottom: 80px;
          animation: fadeUp 0.7s ease 0.5s both;
        }
        .btn-green {
          background: #25D366; color: #fff;
          font-size: 15px; font-weight: 700;
          padding: 13px 28px; border-radius: 10px;
          text-decoration: none;
          transition: opacity 0.15s, transform 0.15s, box-shadow 0.15s;
          box-shadow: 0 4px 14px rgba(37,211,102,0.35);
        }
        .btn-green:hover { opacity: 0.9; transform: translateY(-2px); box-shadow: 0 8px 20px rgba(37,211,102,0.4); }
        .btn-outline {
          background: transparent; color: #444;
          font-size: 15px; font-weight: 500;
          padding: 13px 22px; border-radius: 10px;
          border: 1px solid #DDD; text-decoration: none;
          transition: border-color 0.15s, background 0.15s, transform 0.15s;
        }
        .btn-outline:hover { border-color: #aaa; background: #FAFAFA; transform: translateY(-1px); }

        /* 3D PRODUCT SECTION */
        .lp-3d-wrap {
          background: #F8F8F8;
          padding: 0 24px 100px;
          overflow: hidden;
        }
        .lp-3d-inner {
          max-width: 1000px;
          margin: 0 auto;
          will-change: transform, opacity;
          transform-origin: center top;
          transform: perspective(1500px) rotateX(28deg) scale(0.88);
          opacity: 0.55;
        }
        .mock {
          background: #18181B;
          border-radius: 16px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.06);
          box-shadow: 0 40px 100px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.04);
        }
        .mock-titlebar {
          background: #111;
          padding: 12px 20px;
          display: flex; align-items: center; gap: 8px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .mock-dot { width: 10px; height: 10px; border-radius: 50%; }
        .mock-dot.r { background: #FF5F57; }
        .mock-dot.y { background: #FEBC2E; }
        .mock-dot.g { background: #28C840; }
        .mock-url {
          margin-right: auto; margin-left: auto;
          background: #222; border-radius: 5px;
          padding: 4px 16px; font-size: 11px; color: #555;
          font-family: 'Courier New', monospace;
        }
        .mock-body {
          display: grid; grid-template-columns: 240px 1fr;
        }
        .mock-sidebar {
          background: #111; border-left: 1px solid rgba(255,255,255,0.05);
          padding: 20px 12px;
          display: flex; flex-direction: column; gap: 2px;
        }
        .mock-nav-item {
          padding: 8px 12px; border-radius: 7px;
          font-size: 12px; color: #666; cursor: default;
          display: flex; align-items: center; gap: 8px;
        }
        .mock-nav-item.active { background: rgba(139,92,246,0.15); color: #A78BFA; }
        .mock-nav-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
        .mock-main { padding: 24px; }
        .mock-stats-row {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;
        }
        .mock-stat {
          background: #222; border-radius: 10px; padding: 16px;
          border: 1px solid rgba(255,255,255,0.05);
        }
        .mock-stat-n { font-size: 22px; font-weight: 700; color: #fff; letter-spacing: -1px; margin-bottom: 3px; }
        .mock-stat-n .g { color: #25D366; }
        .mock-stat-l { font-size: 11px; color: #555; }
        .mock-section-title { font-size: 11px; font-weight: 600; color: #555; margin-bottom: 10px; letter-spacing: 0.05em; text-transform: uppercase; }
        .mock-appt-list { display: flex; flex-direction: column; gap: 6px; }
        .mock-appt {
          background: #222; border-radius: 8px; padding: 10px 14px;
          display: flex; align-items: center; gap: 10px;
          border: 1px solid rgba(255,255,255,0.04);
        }
        .mock-appt-time { font-size: 11px; color: #555; font-family: 'Courier New', monospace; flex-shrink: 0; }
        .mock-appt-name { font-size: 12px; color: #ccc; flex: 1; }
        .mock-appt-service { font-size: 11px; color: #555; }
        .mock-appt-badge {
          font-size: 9px; font-weight: 600; padding: 2px 8px; border-radius: 4px;
          flex-shrink: 0;
        }
        .mock-appt-badge.confirmed { background: rgba(37,211,102,0.12); color: #25D366; }
        .mock-appt-badge.pending { background: rgba(251,191,36,0.12); color: #FBBF24; }

        /* TRUST BAR */
        .lp-trust {
          background: #fff;
          border-top: 1px solid #EBEBEB;
          border-bottom: 1px solid #EBEBEB;
          padding: 20px 40px;
          display: flex; align-items: center; justify-content: center; gap: 44px;
          flex-wrap: wrap;
        }
        .lp-trust-label { font-size: 11px; color: #BBB; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
        .lp-trust-items { display: flex; align-items: center; gap: 28px; flex-wrap: wrap; }
        .lp-trust-item { display: flex; align-items: center; gap: 7px; font-size: 13px; color: #666; font-weight: 500; }

        /* HOW IT WORKS */
        .lp-steps { padding: 100px 40px; max-width: 1080px; margin: 0 auto; }
        .lp-label { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #25D366; margin-bottom: 12px; }
        .lp-title { font-size: clamp(28px, 3.5vw, 44px); font-weight: 800; letter-spacing: -1.5px; color: #0A0A0A; margin-bottom: 56px; line-height: 1.1; }
        .lp-steps-grid {
          display: grid; grid-template-columns: repeat(3, 1fr);
          gap: 0;
          border: 1px solid #E8E8E8; border-radius: 14px; overflow: hidden;
        }
        .lp-step {
          padding: 40px 34px;
          background: #fff;
          border-left: 1px solid #EBEBEB;
          transition: background 0.2s;
        }
        .lp-step:hover { background: #FAFAFA; }
        .lp-step:last-child { border-left: none; }
        .lp-step-num { font-size: 12px; font-weight: 700; color: #25D366; margin-bottom: 20px; letter-spacing: 0.06em; }
        .lp-step-title { font-size: 16px; font-weight: 700; color: #111; margin-bottom: 10px; letter-spacing: -0.3px; line-height: 1.35; }
        .lp-step-desc { font-size: 13.5px; color: #777; line-height: 1.7; }

        /* FEATURES */
        .lp-features { background: #F8F8F8; border-top: 1px solid #EBEBEB; border-bottom: 1px solid #EBEBEB; padding: 100px 40px; }
        .lp-features-inner { max-width: 1080px; margin: 0 auto; }
        .lp-feats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 52px; }
        .lp-feat {
          background: #fff; border: 1px solid #E8E8E8; border-radius: 12px; padding: 28px 24px;
          transition: transform 0.18s ease, box-shadow 0.18s ease;
          cursor: default;
          transform-style: preserve-3d;
        }
        .lp-feat:hover { box-shadow: 0 16px 40px rgba(0,0,0,0.08); }
        .lp-feat-icon {
          width: 42px; height: 42px; border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 16px; font-size: 20px;
          background: #F0FFF4;
        }
        .lp-feat-title { font-size: 15px; font-weight: 700; color: #111; margin-bottom: 7px; letter-spacing: -0.2px; }
        .lp-feat-desc { font-size: 13px; color: #777; line-height: 1.65; }

        /* PREMIUM VOICE SECTION */
        .lp-premium {
          background: #0A0A0A;
          padding: 100px 40px;
          position: relative;
          overflow: hidden;
        }
        .lp-premium::before {
          content: '';
          position: absolute;
          top: -120px; right: -120px;
          width: 500px; height: 500px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(245,158,11,0.06) 0%, transparent 70%);
          pointer-events: none;
        }
        .lp-premium-inner {
          max-width: 1080px; margin: 0 auto;
          display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: center;
        }
        .lp-premium-badge {
          display: inline-flex; align-items: center; gap: 6px;
          background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.25);
          color: #F59E0B; font-size: 11px; font-weight: 700;
          padding: 4px 12px; border-radius: 20px;
          margin-bottom: 18px; letter-spacing: 0.08em; text-transform: uppercase;
        }
        .lp-premium-title {
          font-size: clamp(28px, 3vw, 42px);
          font-weight: 800; color: #fff;
          letter-spacing: -1.5px; line-height: 1.1; margin-bottom: 16px;
        }
        .lp-premium-title .amber { color: #F59E0B; }
        .lp-premium-desc { font-size: 15px; color: rgba(255,255,255,0.45); line-height: 1.75; margin-bottom: 28px; }
        .lp-premium-note {
          display: inline-flex; align-items: center; gap: 8px;
          background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.15);
          border-radius: 8px; padding: 10px 16px;
          font-size: 13px; color: rgba(255,255,255,0.5); margin-bottom: 32px;
        }
        .lp-premium-note strong { color: #F59E0B; }
        .btn-amber {
          display: inline-flex; align-items: center; gap: 8px;
          background: #F59E0B; color: #000;
          font-size: 14px; font-weight: 700;
          padding: 12px 24px; border-radius: 9px;
          text-decoration: none;
          transition: opacity 0.15s, transform 0.15s, box-shadow 0.15s;
          box-shadow: 0 4px 16px rgba(245,158,11,0.3);
        }
        .btn-amber:hover { opacity: 0.88; transform: translateY(-2px); box-shadow: 0 8px 24px rgba(245,158,11,0.4); }

        /* VOICE CARD */
        .voice-card {
          background: #141414; border: 1px solid rgba(255,255,255,0.07);
          border-radius: 14px; overflow: hidden;
        }
        .voice-card-header {
          padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex; align-items: center; gap: 10px;
        }
        .voice-live-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #F59E0B; flex-shrink: 0;
          animation: pulse-amber 2s infinite;
        }
        @keyframes pulse-amber {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(245,158,11,0.4); }
          50% { opacity: 0.7; box-shadow: 0 0 0 4px rgba(245,158,11,0); }
        }
        .voice-card-title { font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.6); }
        .voice-card-duration { font-size: 11px; color: rgba(255,255,255,0.25); font-family: 'Courier New', monospace; margin-right: auto; }
        .voice-waveform {
          padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex; align-items: center; gap: 3px; height: 56px;
        }
        .vbar {
          width: 3px; border-radius: 2px; background: #F59E0B; flex-shrink: 0;
          animation: vwave 1.4s ease-in-out infinite;
          transform-origin: bottom;
        }
        .vbar:nth-child(1)  { height: 10px; animation-delay: 0s; }
        .vbar:nth-child(2)  { height: 22px; animation-delay: 0.08s; }
        .vbar:nth-child(3)  { height: 30px; animation-delay: 0.16s; }
        .vbar:nth-child(4)  { height: 18px; animation-delay: 0.24s; }
        .vbar:nth-child(5)  { height: 36px; animation-delay: 0.12s; }
        .vbar:nth-child(6)  { height: 14px; animation-delay: 0.2s; }
        .vbar:nth-child(7)  { height: 28px; animation-delay: 0.06s; }
        .vbar:nth-child(8)  { height: 40px; animation-delay: 0.14s; }
        .vbar:nth-child(9)  { height: 20px; animation-delay: 0.22s; }
        .vbar:nth-child(10) { height: 32px; animation-delay: 0.1s; }
        .vbar:nth-child(11) { height: 16px; animation-delay: 0.18s; }
        .vbar:nth-child(12) { height: 24px; animation-delay: 0.04s; }
        .vbar:nth-child(13) { height: 38px; animation-delay: 0.28s; }
        .vbar:nth-child(14) { height: 12px; animation-delay: 0.32s; }
        .vbar:nth-child(15) { height: 8px;  animation-delay: 0.36s; }
        @keyframes vwave {
          0%, 100% { transform: scaleY(1); opacity: 0.9; }
          50% { transform: scaleY(0.25); opacity: 0.4; }
        }
        .voice-transcript { padding: 16px 20px; display: flex; flex-direction: column; gap: 14px; }
        .vline { font-size: 12px; line-height: 1.5; }
        .vspeaker {
          font-family: 'Courier New', monospace; font-size: 9px;
          letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 2px;
        }
        .vspeaker.caller { color: rgba(255,255,255,0.25); }
        .vspeaker.ai { color: #F59E0B; }
        .vline.caller-l { color: rgba(255,255,255,0.4); }
        .vline.ai-l { color: rgba(255,255,255,0.8); font-weight: 500; }

        /* CTA */
        .lp-cta { background: #fff; padding: 100px 40px; text-align: center; border-top: 1px solid #EBEBEB; }
        .lp-cta-title { font-size: clamp(28px, 4.5vw, 56px); font-weight: 800; letter-spacing: -2.5px; color: #0A0A0A; margin-bottom: 12px; line-height: 1.05; }
        .lp-cta-sub { font-size: 16px; color: #888; margin-bottom: 36px; }
        .lp-cta-row { display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; }

        /* FOOTER */
        .lp-footer {
          background: #0A0A0A; border-top: 1px solid rgba(255,255,255,0.06);
          padding: 22px 44px;
          display: flex; align-items: center; justify-content: space-between;
        }
        .lp-footer-left { display: flex; align-items: center; gap: 8px; }
        .lp-footer-left img { width: 22px; height: 22px; border-radius: 5px; opacity: 0.5; }
        .lp-footer-brand { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.35); }
        .lp-footer-copy { font-size: 12px; color: rgba(255,255,255,0.2); }

        /* ANIMATIONS */
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(22px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes fadeDown {
          from { opacity: 0; transform: translateY(-10px); }
          to   { opacity: 1; transform: none; }
        }
        .reveal {
          opacity: 0; transform: translateY(22px);
          transition: opacity 0.6s ease, transform 0.6s ease;
        }
        .reveal.in { opacity: 1; transform: none; }
        .reveal.d1 { transition-delay: 0.08s; }
        .reveal.d2 { transition-delay: 0.16s; }
        .reveal.d3 { transition-delay: 0.24s; }
        .reveal.d4 { transition-delay: 0.08s; }
        .reveal.d5 { transition-delay: 0.16s; }
        .reveal.d6 { transition-delay: 0.24s; }

        /* RESPONSIVE */
        @media (max-width: 900px) {
          .lp-nav { padding: 0 20px; }
          .lp-nav-links { display: none; }
          .mock-body { grid-template-columns: 1fr; }
          .mock-sidebar { display: none; }
          .lp-steps { padding: 72px 20px; }
          .lp-steps-grid { grid-template-columns: 1fr; }
          .lp-step { border-left: none; border-bottom: 1px solid #EBEBEB; }
          .lp-step:last-child { border-bottom: none; }
          .lp-features { padding: 72px 20px; }
          .lp-feats-grid { grid-template-columns: 1fr 1fr; gap: 12px; }
          .lp-premium { padding: 72px 20px; }
          .lp-premium-inner { grid-template-columns: 1fr; gap: 48px; }
          .lp-cta { padding: 72px 20px; }
          .lp-footer { padding: 20px; flex-direction: column; gap: 8px; }
          .lp-trust { padding: 16px 20px; gap: 16px; }
        }
        @media (max-width: 540px) {
          .lp-feats-grid { grid-template-columns: 1fr; }
          .mock-stats-row { grid-template-columns: repeat(3, 1fr); gap: 8px; }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
          .lp-3d-inner { transform: none !important; opacity: 1 !important; }
        }
      `}</style>

      <div id="scroll-bar" />

      <div className="lp">
        {/* NAV */}
        <nav className="lp-nav">
          <a className="lp-nav-logo" href="#">
            <img src="/tori-logo-black.png" alt="תורי" />
            <span>תורי</span>
          </a>
          <div className="lp-nav-links">
            <a className="lp-nav-link" href="#how">איך זה עובד</a>
            <a className="lp-nav-link" href="#features">תכונות</a>
            <a className="lp-nav-link" href="#premium">פרמיום</a>
          </div>
          <a className="lp-nav-cta" href="/login">כניסה לדשבורד ←</a>
        </nav>

        {/* HERO */}
        <section className="lp-hero">
          <div className="lp-kicker">
            <span className="lp-kicker-dot" />
            WhatsApp · Google Calendar · AI
          </div>
          <h1 className="lp-h1">
            הסלון שלך מקבל תורים<br />
            <span className="green">בזמן שאתה עובד.</span>
          </h1>
          <p className="lp-hero-sub">
            בוט AI עונה ללקוחות בוואטסאפ, קובע תורים, ומסנכרן הכל לגוגל קלנדר — אוטומטי לחלוטין.
          </p>
          <div className="lp-hero-ctas">
            <a className="btn-green" href="/login">התחל בחינם</a>
            <a className="btn-outline" href="#how">ראה איך זה עובד</a>
          </div>
        </section>

        {/* 3D PRODUCT PREVIEW */}
        <div className="lp-3d-wrap">
          <div className="lp-3d-inner" ref={tiltEl}>
            <div className="mock">
              <div className="mock-titlebar">
                <span className="mock-dot r" /><span className="mock-dot y" /><span className="mock-dot g" />
                <span className="mock-url">torionline.com/dashboard</span>
              </div>
              <div className="mock-body">
                <div className="mock-sidebar">
                  <div className="mock-nav-item active"><span className="mock-nav-dot" />תורים</div>
                  <div className="mock-nav-item"><span className="mock-nav-dot" />לקוחות</div>
                  <div className="mock-nav-item"><span className="mock-nav-dot" />שירותים</div>
                  <div className="mock-nav-item"><span className="mock-nav-dot" />אנליטיקה</div>
                  <div className="mock-nav-item"><span className="mock-nav-dot" />הגדרות</div>
                </div>
                <div className="mock-main">
                  <div className="mock-stats-row">
                    <div className="mock-stat">
                      <div className="mock-stat-n">47</div>
                      <div className="mock-stat-l">תורים החודש</div>
                    </div>
                    <div className="mock-stat">
                      <div className="mock-stat-n"><span className="g">₪</span>8,240</div>
                      <div className="mock-stat-l">הכנסה</div>
                    </div>
                    <div className="mock-stat">
                      <div className="mock-stat-n">23</div>
                      <div className="mock-stat-l">לקוחות חדשים</div>
                    </div>
                  </div>
                  <div className="mock-section-title">תורים קרובים</div>
                  <div className="mock-appt-list">
                    <div className="mock-appt">
                      <span className="mock-appt-time">09:30</span>
                      <span className="mock-appt-name">דנה כהן</span>
                      <span className="mock-appt-service">תספורת</span>
                      <span className="mock-appt-badge confirmed">מאושר</span>
                    </div>
                    <div className="mock-appt">
                      <span className="mock-appt-time">11:00</span>
                      <span className="mock-appt-name">מיכל לוי</span>
                      <span className="mock-appt-service">צבע</span>
                      <span className="mock-appt-badge confirmed">מאושר</span>
                    </div>
                    <div className="mock-appt">
                      <span className="mock-appt-time">14:30</span>
                      <span className="mock-appt-name">יוסי אברהם</span>
                      <span className="mock-appt-service">תספורת + זקן</span>
                      <span className="mock-appt-badge pending">ממתין</span>
                    </div>
                    <div className="mock-appt">
                      <span className="mock-appt-time">16:00</span>
                      <span className="mock-appt-name">שרה גולדברג</span>
                      <span className="mock-appt-service">טיפול פנים</span>
                      <span className="mock-appt-badge confirmed">מאושר</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* TRUST BAR */}
        <div className="lp-trust">
          <span className="lp-trust-label">עובד עם</span>
          <div className="lp-trust-items">
            <div className="lp-trust-item">
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path d="M17.6 6.31a8 8 0 10-3.07 13.56l1.5-2.6A5.97 5.97 0 0112 18a6 6 0 010-12c1.53 0 2.93.58 3.98 1.52L13 10.5h6V4.5l-1.4 1.81z" fill="#25D366"/>
              </svg>
              WhatsApp Business
            </div>
            <div className="lp-trust-item">
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Google Calendar
            </div>
            <div className="lp-trust-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
              דשבורד ניהול
            </div>
            <div className="lp-trust-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
              שיחות טלפון AI
            </div>
          </div>
        </div>

        {/* HOW IT WORKS */}
        <section className="lp-steps" id="how">
          <div className="lp-label reveal">תהליך</div>
          <div className="lp-title reveal">שלושה צעדים. הכל קורה לבד.</div>
          <div className="lp-steps-grid">
            <div className="lp-step reveal d1">
              <div className="lp-step-num">01</div>
              <div className="lp-step-title">לקוח שולח הודעה ב-WhatsApp</div>
              <div className="lp-step-desc">הלקוח כותב בשפה רגילה — "רוצה תספורת ביום חמישי". הבוט מבין ועונה תוך שנייה, בעברית טבעית.</div>
            </div>
            <div className="lp-step reveal d2">
              <div className="lp-step-num">02</div>
              <div className="lp-step-title">הבוט מציע זמנים ומאשר</div>
              <div className="lp-step-desc">הבוט בודק את היומן הפנוי, מציע מועדים, מקבל אישור וקובע את התור — בלי שנגעת בטלפון.</div>
            </div>
            <div className="lp-step reveal d3">
              <div className="lp-step-num">03</div>
              <div className="lp-step-title">גוגל קלנדר מתעדכן אוטומטית</div>
              <div className="lp-step-desc">כל תור מופיע מיידית בגוגל קלנדר שלך עם שם הלקוח, השירות, ושעת הסיום. חיבור חד-פעמי.</div>
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section className="lp-features" id="features">
          <div className="lp-features-inner">
            <div className="lp-label reveal">מה כלול</div>
            <div className="lp-title reveal">כל מה שסלון או קליניקה צריכים.</div>
            <div className="lp-feats-grid">
              {[
                { icon: "💬", title: "בוט WhatsApp בעברית", desc: "מבין שפה טבעית, עונה ב-24/7, ומנהל שיחה מתחילה ועד אישור התור." },
                { icon: "📅", title: "סנכרון גוגל קלנדר", desc: "חיבור חד-פעמי. כל תור שנקבע נכנס ליומן אוטומטית עם כל הפרטים." },
                { icon: "🔔", title: "תזכורות אוטומטיות", desc: "הבוט שולח תזכורת ללקוח לפני כל תור. פחות no-shows, פחות שיחות." },
                { icon: "📊", title: "דשבורד ניהול", desc: "הכנסות, תורים, לקוחות ושירותים פופולריים — הכל במסך אחד, בזמן אמת." },
                { icon: "⏰", title: "שעות פתיחה גמישות", desc: "הגדר ימים ושעות לכל שירות וצוות. הבוט לא יציע זמנים שלא מתאימים." },
                { icon: "📋", title: "רשימת המתנה", desc: "אין זמינות? הבוט מוסיף לרשימת המתנה ומיידע אותך כשמשהו מתפנה." },
              ].map((f, i) => (
                <div key={i} className={`lp-feat reveal d${(i % 3) + 1}`}>
                  <div className="lp-feat-icon">{f.icon}</div>
                  <div className="lp-feat-title">{f.title}</div>
                  <div className="lp-feat-desc">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PREMIUM VOICE */}
        <section className="lp-premium" id="premium">
          <div className="lp-premium-inner">
            <div className="reveal">
              <div className="lp-premium-badge">★ פרמיום</div>
              <div className="lp-premium-title">
                גם שיחות טלפון —<br />
                <span className="amber">הבוט עונה.</span>
              </div>
              <div className="lp-premium-desc">
                לקוח מתקשר. סוכן AI עונה בקול טבעי, מנהל שיחה, קובע תור ומסנכרן לגוגל קלנדר — בלי שהרמת אצבע.
              </div>
              <div className="lp-premium-note">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                תכונה זו זמינה ב<strong>תוכנית פרמיום</strong> בתוספת תשלום חודשי
              </div>
              <a className="btn-amber" href="/login">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                גלה את פרמיום
              </a>
            </div>

            <div className="voice-card reveal d2">
              <div className="voice-card-header">
                <div className="voice-live-dot" />
                <div className="voice-card-title">שיחה נכנסת</div>
                <div className="voice-card-duration">00:42</div>
              </div>
              <div className="voice-waveform">
                {Array.from({ length: 15 }).map((_, i) => (
                  <div key={i} className="vbar" />
                ))}
              </div>
              <div className="voice-transcript">
                <div className="vline caller-l">
                  <div className="vspeaker caller">לקוח</div>
                  שלום, רציתי לקבוע תספורת ליום חמישי בבוקר
                </div>
                <div className="vline ai-l">
                  <div className="vspeaker ai">תורי AI</div>
                  שלום! ביום חמישי יש לי פנוי ב-9:30 וב-11:00. מה מתאים?
                </div>
                <div className="vline caller-l">
                  <div className="vspeaker caller">לקוח</div>
                  9:30 מושלם
                </div>
                <div className="vline ai-l">
                  <div className="vspeaker ai">תורי AI</div>
                  מעולה. קבעתי תספורת ביום חמישי ב-9:30. תקבל אישור בוואטסאפ.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="lp-cta reveal">
          <div className="lp-cta-title">מוכן? זה לוקח 3 דקות.</div>
          <div className="lp-cta-sub">ניסיון חינם. אין צורך בכרטיס אשראי.</div>
          <div className="lp-cta-row">
            <a className="btn-green" href="/login">התחל עכשיו</a>
            <a className="btn-outline" href="#premium">ראה תוכנית פרמיום</a>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="lp-footer">
          <div className="lp-footer-left">
            <img src="/tori-logo-black.png" alt="תורי" />
            <span className="lp-footer-brand">תורי</span>
          </div>
          <span className="lp-footer-copy">© 2026 torionline.com</span>
        </footer>
      </div>
    </>
  );
}
