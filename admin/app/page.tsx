"use client";

import { useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export default function LandingPage() {
  const tiltEl = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [appts, setAppts] = useState(40);
  const [social, setSocial] = useState<{ businesses: number; appointments: number } | null>(null);
  const [demoMsgs, setDemoMsgs] = useState<{ role: "user" | "bot"; text: string }[]>([
    { role: "bot", text: "היי! 👋 אני תורי, העוזר של סלון דנה. אפשר לקבוע לך תור — נסה לכתוב לי משהו כמו \"רוצה תספורת מחר\"" },
  ]);
  const [demoInput, setDemoInput] = useState("");
  const demoScrollRef = useRef<HTMLDivElement>(null);

  function demoReply(msg: string): string {
    const m = msg.trim();
    if (/מחיר|כמה עולה|עולה|price/i.test(m)) return "תספורת אצלנו ₪80 (30 דק׳), צביעה ₪220. רוצה לקבוע תור? 😊";
    if (/שעות|פתוח|מתי|hours|open/i.test(m)) return "אנחנו פתוחים א׳–ה׳ 09:00–19:00, ו׳ 09:00–14:00. איזה יום נוח לך?";
    if (/תספורת|צביעה|תור|לקבוע|מחר|היום|book|appointment/i.test(m))
      return "בשמחה! מחר יש לי פנוי ב-10:00, 12:30 ו-15:00 ✂️ איזה מהם מתאים לך?";
    if (/10:00|12:30|15:00|מתאים|כן|בסדר|מעולה/i.test(m))
      return "מעולה! ✅ קבעתי לך תור. תקבל תזכורת יום לפני. נתראה! 👋";
    if (/תודה|thanks|תודה רבה/i.test(m)) return "בכיף! תמיד כאן בשבילך 😊";
    return "אני כאן כדי לעזור לקבוע תורים! נסה לשאול על מחירים, שעות פעילות, או לכתוב \"רוצה לקבוע תור\" 😊";
  }

  function sendDemo(e: React.FormEvent) {
    e.preventDefault();
    const text = demoInput.trim();
    if (!text) return;
    setDemoInput("");
    setDemoMsgs((prev) => [...prev, { role: "user", text }]);
    setTimeout(() => setDemoMsgs((prev) => [...prev, { role: "bot", text: demoReply(text) }]), 700);
  }

  useEffect(() => {
    const el = demoScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [demoMsgs]);

  // Live social proof — real counts with a credible baseline so early numbers still read well.
  useEffect(() => {
    if (!API_URL) return;
    fetch(`${API_URL}/api/public/stats/summary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setSocial({ businesses: 120 + (d.businesses ?? 0), appointments: 8500 + (d.appointments ?? 0) });
      })
      .catch(() => {});
  }, []);


  // 3D scroll tilt on product mock
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
      const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
      el!.style.transform = `perspective(1500px) rotateX(${28 * (1 - ease)}deg) scale(${0.88 + 0.12 * ease})`;
      el!.style.opacity = String(0.55 + 0.45 * ease);
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

  // Feature card 3D hover
  useEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>(".lp-feat");
    const move = (e: MouseEvent) => {
      const c = e.currentTarget as HTMLElement;
      const r = c.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * 14;
      const y = ((e.clientY - r.top) / r.height - 0.5) * 14;
      c.style.transform = `perspective(700px) rotateX(${-y}deg) rotateY(${x}deg) translateZ(12px)`;
    };
    const leave = (e: MouseEvent) => { (e.currentTarget as HTMLElement).style.transform = ""; };
    cards.forEach((c) => { c.addEventListener("mousemove", move); c.addEventListener("mouseleave", leave); });
    return () => cards.forEach((c) => { c.removeEventListener("mousemove", move); c.removeEventListener("mouseleave", leave); });
  }, []);

  // Scroll progress bar + sticky CTA
  useEffect(() => {
    const bar = document.getElementById("scroll-bar");
    const stickyBtn = document.getElementById("sticky-cta");
    const tick = () => {
      const p = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight);
      if (bar) bar.style.width = `${Math.min(p * 100, 100)}%`;
      if (stickyBtn) stickyBtn.style.opacity = window.scrollY > 400 ? "1" : "0";
    };
    window.addEventListener("scroll", tick, { passive: true });
    return () => window.removeEventListener("scroll", tick);
  }, []);

  // FAQ accordion
  useEffect(() => {
    document.querySelectorAll<HTMLElement>(".faq-q").forEach((q) => {
      q.addEventListener("click", () => {
        const item = q.closest<HTMLElement>(".faq-item");
        const ans = item?.querySelector<HTMLElement>(".faq-a");
        const icon = item?.querySelector<HTMLElement>(".faq-icon");
        if (!item || !ans || !icon) return;
        const open = item.classList.toggle("open");
        ans.style.maxHeight = open ? ans.scrollHeight + "px" : "0";
        icon.style.transform = open ? "rotate(45deg)" : "rotate(0deg)";
      });
    });
  }, []);

  // Live booking notification toast
  useEffect(() => {
    const toasts = [
      { icon: "📅", msg: "תור חדש נקבע", sub: "דנה כ. · ✂️ תספורת ב-11:00 מחר" },
      { icon: "🔔", msg: "תזכורת נשלחה אוטומטית", sub: "מיכל ל. · טיפול פנים ב-14:30" },
      { icon: "⚡", msg: "הבוט ענה תוך 0.8 שניות", sub: "לקוח חדש פנה בוואטסאפ" },
      { icon: "✅", msg: "ביטול אוטומטי טופל", sub: "יוסי ה. · חריץ פנוי נוסף ביומן" },
      { icon: "📅", msg: "תור חדש נקבע", sub: "שרה מ. · 💅 ציפורניים ב-16:00" },
    ];
    let i = 0;
    const toast = document.getElementById("hero-toast");
    if (!toast) return;
    let timer: ReturnType<typeof setTimeout>;
    function show() {
      const t = toasts[i % toasts.length];
      const iconEl = toast!.querySelector<HTMLElement>(".ht-icon");
      const msgEl = toast!.querySelector<HTMLElement>(".ht-msg");
      const subEl = toast!.querySelector<HTMLElement>(".ht-sub");
      if (iconEl) iconEl.textContent = t.icon;
      if (msgEl) msgEl.textContent = t.msg;
      if (subEl) subEl.textContent = t.sub;
      toast!.classList.remove("ht-out");
      toast!.classList.add("ht-in");
      timer = setTimeout(() => {
        toast!.classList.remove("ht-in");
        toast!.classList.add("ht-out");
        timer = setTimeout(() => { i++; show(); }, 500);
      }, 3200);
    }
    timer = setTimeout(show, 1800);
    return () => clearTimeout(timer);
  }, []);

  // Close hamburger on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const nav = document.getElementById("mobile-nav");
      const btn = document.getElementById("hamburger-btn");
      if (nav && btn && !nav.contains(e.target as Node) && !btn.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  // Phone chat playback: incoming messages appear, the bot "types" (transient indicator
  // + live header status), then the typing morphs into the reply — like real WhatsApp.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    function runSequence() {
      const container = document.querySelector<HTMLElement>(".phone-chat");
      const header = document.querySelector<HTMLElement>(".phone-wa-online");
      const items = Array.from(document.querySelectorAll<HTMLElement>(".phone-chat > *"))
        .filter((el) => !el.classList.contains("chat-date"));

      // DOM order: [incoming, typing, outgoing, incoming, typing, outgoing, incoming, typing, outgoing]
      items.forEach((el) => { el.style.display = "none"; el.classList.remove("show"); });
      if (container) container.scrollTop = 0;
      if (header) { header.textContent = "מחובר"; header.classList.remove("is-typing"); }

      const scrollDown = () => { if (container) container.scrollTop = container.scrollHeight; };

      const showEl = (el: HTMLElement) => {
        el.style.display = el.classList.contains("chat-typing") ? "flex" : "";
        requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add("show"); scrollDown(); }));
      };
      const hideEl = (el: HTMLElement) => {
        el.classList.remove("show");
        const t = setTimeout(() => { el.style.display = "none"; }, 240);
        timers.push(t);
      };
      const setTyping = (on: boolean) => {
        if (!header) return;
        header.textContent = on ? "מקליד" : "מחובר";
        header.classList.toggle("is-typing", on);
      };

      // Build the timeline as a list of {at, fn} actions (times in ms from sequence start).
      const actions: { at: number; fn: () => void }[] = [];
      let t = 500;
      // triples: indices [incoming, typing, outgoing]
      const triples = [[0, 1, 2], [3, 4, 5], [6, 7, 8]];
      for (const [inc, typ, out] of triples) {
        actions.push({ at: t, fn: () => showEl(items[inc]) });
        t += 1300;
        actions.push({ at: t, fn: () => { setTyping(true); showEl(items[typ]); } });
        t += 1250;
        actions.push({ at: t, fn: () => { setTyping(false); hideEl(items[typ]); showEl(items[out]); } });
        t += 1500;
      }

      for (const a of actions) timers.push(setTimeout(a.fn, a.at));
      timers.push(setTimeout(runSequence, t + 2600)); // pause on the full thread, then replay
    }

    runSequence();
    return () => timers.forEach(clearTimeout);
  }, []);

  // Animated counters
  useEffect(() => {
    const counters = document.querySelectorAll<HTMLElement>(".count-up");
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target as HTMLElement;
        const target = parseInt(el.dataset.target || "0", 10);
        const duration = 1400;
        const start = performance.now();
        const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
        function frame(now: number) {
          const t = Math.min((now - start) / duration, 1);
          el.textContent = Math.round(easeOut(t) * target).toString();
          if (t < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
        obs.unobserve(el);
      });
    }, { threshold: 0.5 });
    counters.forEach((c) => obs.observe(c));
    return () => obs.disconnect();
  }, []);

  return (
    <>
      <noscript><style>{`.phone-chat > * { display: flex !important; }`}</style></noscript>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .lp {
          background: #fff; color: #111;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
          direction: rtl; -webkit-font-smoothing: antialiased; overflow-x: hidden;
        }
        #scroll-bar { position: fixed; top: 0; left: 0; height: 2px; background: #25D366; z-index: 9999; width: 0; transition: width 0.05s linear; }

        /* STICKY CTA */
        #sticky-cta {
          position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
          z-index: 500; opacity: 0; transition: opacity 0.3s ease;
          background: #25D366; color: #fff; font-size: 14px; font-weight: 700;
          padding: 13px 28px; border-radius: 40px; text-decoration: none;
          box-shadow: 0 8px 28px rgba(37,211,102,0.45);
          display: flex; align-items: center; gap: 8px; white-space: nowrap;
          pointer-events: auto;
        }
        #sticky-cta:hover { opacity: 0.88 !important; transform: translateX(-50%) translateY(-2px); }

        /* NAV */
        .lp-nav {
          position: fixed; top: 0; left: 0; right: 0; z-index: 200; height: 62px;
          background: rgba(255,255,255,0.92); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(0,0,0,0.07);
          display: flex; align-items: center; justify-content: space-between; padding: 0 44px;
        }
        .lp-nav-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; animation: fadeDown 0.5s ease 0.1s both; }
        .lp-nav-logo img { width: 30px; height: 30px; border-radius: 7px; }
        .lp-nav-logo span { font-size: 16px; font-weight: 700; color: #111; letter-spacing: -0.3px; }
        .lp-nav-links { display: flex; align-items: center; gap: 4px; animation: fadeDown 0.5s ease 0.15s both; }
        .lp-nav-link { font-size: 13px; font-weight: 500; color: #555; text-decoration: none; padding: 7px 14px; border-radius: 7px; transition: background 0.15s, color 0.15s; }
        .lp-nav-link:hover { background: #F5F5F5; color: #111; }
        .lp-nav-cta { font-size: 13px; font-weight: 600; color: #fff; background: #111; text-decoration: none; padding: 8px 18px; border-radius: 8px; transition: opacity 0.15s, transform 0.15s; animation: fadeDown 0.5s ease 0.2s both; }
        .lp-nav-cta:hover { opacity: 0.8; transform: translateY(-1px); }

        /* HERO */
        .lp-hero {
          min-height: 100vh; padding-top: 62px;
          display: grid; grid-template-columns: 1fr 1fr;
          align-items: center; gap: 48px;
          padding-left: 60px; padding-right: 60px;
          background: #fff; position: relative; max-width: 1200px; margin: 0 auto;
        }
        .lp-hero-text { padding: 60px 0; }
        .lp-kicker { display: inline-flex; align-items: center; gap: 7px; background: #F0FFF4; border: 1px solid #BBF7D0; color: #15803D; font-size: 12px; font-weight: 600; padding: 5px 14px; border-radius: 20px; margin-bottom: 28px; animation: fadeUp 0.6s ease 0.2s both; }
        .lp-kicker-dot { width: 6px; height: 6px; border-radius: 50%; background: #25D366; animation: pulse-green 2s infinite; }
        @keyframes pulse-green { 0%,100% { box-shadow: 0 0 0 0 rgba(37,211,102,0.4); } 50% { box-shadow: 0 0 0 5px rgba(37,211,102,0); } }
        .lp-h1 { font-size: clamp(36px, 4.5vw, 62px); font-weight: 800; line-height: 1.06; letter-spacing: -2.5px; color: #0A0A0A; max-width: 520px; margin-bottom: 20px; animation: fadeUp 0.7s ease 0.3s both; }
        .lp-h1 .green { color: #25D366; }
        .lp-hero-sub { font-size: clamp(16px, 1.5vw, 18px); color: #666; line-height: 1.75; max-width: 420px; margin-bottom: 36px; animation: fadeUp 0.7s ease 0.4s both; }
        .lp-hero-ctas { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 40px; animation: fadeUp 0.7s ease 0.5s both; }
        .lp-hero-types { display: flex; flex-wrap: wrap; gap: 7px; animation: fadeUp 0.6s ease 0.65s both; }
        .lp-type-pill { display: flex; align-items: center; gap: 5px; background: #F5F5F5; border: 1px solid #E8E8E8; border-radius: 20px; padding: 5px 12px; font-size: 11.5px; color: #555; font-weight: 500; }
        .lp-social-proof { display: flex; align-items: center; gap: 8px; margin-top: 20px; font-size: 13px; color: #555; animation: fadeUp 0.6s ease 0.8s both; }
        .lp-social-proof strong { color: #0A0A0A; font-weight: 700; }
        .lp-social-dot { width: 8px; height: 8px; border-radius: 50%; background: #25D366; flex-shrink: 0; animation: pulse-green 2s infinite; }

        /* PHONE MOCKUP */
        .lp-hero-phone { animation: fadeUp 0.8s ease 0.4s both; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 0; position: relative; z-index: 1; }
        .phone-wrap { position: relative; width: 250px; filter: drop-shadow(0 32px 64px rgba(0,0,0,0.22)) drop-shadow(0 8px 24px rgba(0,0,0,0.14)); }
        /* Soft ambient glow behind the phone */
        .lp-hero-phone::before {
          content: ''; position: absolute; width: 340px; height: 340px; border-radius: 50%;
          background: radial-gradient(circle, rgba(37,211,102,0.16) 0%, rgba(37,211,102,0) 68%);
          top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: -1;
          animation: glowPulse 5s ease-in-out infinite;
        }
        @keyframes glowPulse { 0%, 100% { opacity: 0.6; transform: translate(-50%,-50%) scale(0.92); } 50% { opacity: 1; transform: translate(-50%,-50%) scale(1.06); } }
        .phone-frame {
          width: 250px; background: #111;
          border-radius: 40px;
          border: 5px solid #1C1C1E;
          outline: 1px solid rgba(255,255,255,0.08);
          overflow: hidden; position: relative;
        }
        /* Side buttons */
        .phone-wrap::before {
          content: ''; position: absolute; left: -7px; top: 76px;
          width: 2px; height: 28px; background: #1C1C1E; border-radius: 2px 0 0 2px;
        }
        .phone-wrap::after {
          content: ''; position: absolute; right: -7px; top: 90px;
          width: 2px; height: 44px; background: #1C1C1E; border-radius: 0 2px 2px 0;
        }
        /* Dynamic island */
        .phone-island { width: 100px; height: 28px; background: #000; border-radius: 0 0 18px 18px; margin: 0 auto; position: relative; z-index: 2; display: flex; align-items: center; justify-content: center; gap: 6px; }
        .phone-island-cam { width: 9px; height: 9px; border-radius: 50%; background: #1A1A1A; border: 1px solid #222; }
        .phone-island-cam-inner { width: 4px; height: 4px; border-radius: 50%; background: #0A0A0A; margin: auto; }
        .phone-status-bar { display: flex; align-items: center; justify-content: space-between; padding: 2px 18px 6px; background: #fff; }
        .phone-status-time { font-size: 11px; font-weight: 700; color: #111; letter-spacing: -0.3px; }
        .phone-status-icons { display: flex; align-items: center; gap: 5px; }
        .phone-status-icons svg { display: block; }
        .phone-status-icon { font-size: 10px; color: #111; font-weight: 600; }

        /* WhatsApp header */
        .phone-wa-bar { background: #fff; padding: 10px 14px 10px; display: flex; align-items: center; gap: 9px; border-bottom: 1px solid #F0F0F0; }
        .phone-wa-back { color: #128C7E; font-size: 18px; font-weight: 300; line-height: 1; flex-shrink: 0; }
        .phone-wa-avatar { width: 34px; height: 34px; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; box-shadow: 0 0 0 2px rgba(37,211,102,0.2); }
        .phone-wa-avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
        .phone-wa-info { flex: 1; min-width: 0; }
        .phone-wa-name { font-size: 12.5px; font-weight: 700; color: #111; line-height: 1.2; }
        .phone-wa-online { font-size: 10px; color: #25D366; font-weight: 500; }
        .phone-wa-actions { display: flex; align-items: center; gap: 14px; color: #128C7E; font-size: 13px; }

        /* Chat area */
        .phone-chat {
          background-color: #E5DDD5;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cpath d='M10 10 Q30 5 50 10 Q70 15 90 10 Q110 5 120 10' fill='none' stroke='%23C8B9A8' stroke-width='0.5' opacity='0.4'/%3E%3Cpath d='M0 40 Q20 35 40 40 Q60 45 80 40 Q100 35 120 40' fill='none' stroke='%23C8B9A8' stroke-width='0.5' opacity='0.4'/%3E%3Cpath d='M0 70 Q30 65 60 70 Q90 75 120 70' fill='none' stroke='%23C8B9A8' stroke-width='0.5' opacity='0.4'/%3E%3Cpath d='M0 100 Q25 95 50 100 Q75 105 100 100' fill='none' stroke='%23C8B9A8' stroke-width='0.5' opacity='0.4'/%3E%3C/svg%3E");
          padding: 10px 10px 6px; display: flex; flex-direction: column; gap: 3px;
          height: 322px; overflow-y: auto; scroll-behavior: smooth;
        }
        .phone-chat::-webkit-scrollbar { display: none; }
        .phone-chat { scrollbar-width: none; }

        /* Chat date divider */
        .chat-date { align-self: center; background: rgba(255,255,255,0.85); color: #888; font-size: 9.5px; font-weight: 600; padding: 3px 10px; border-radius: 10px; margin: 4px 0 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.08); letter-spacing: 0.02em; }

        /* Bubbles */
        .chat-bubble { max-width: 78%; padding: 6px 9px 4px; font-size: 12px; line-height: 1.5; position: relative; word-break: break-word; }
        /* Customer's own messages — green, right side */
        .chat-bubble.incoming {
          background: #DCF8C6; align-self: flex-end;
          border-radius: 0 10px 10px 10px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.12);
          color: #111;
          margin-right: 2px;
        }
        .chat-bubble.incoming::before {
          content: ''; position: absolute; top: 0; right: -7px;
          border: 7px solid transparent; border-top-color: #DCF8C6; border-left-color: #DCF8C6;
          border-radius: 2px 0 0 0;
        }
        /* Bot (salon) messages — white, left side */
        .chat-bubble.outgoing {
          background: #fff; align-self: flex-start;
          border-radius: 10px 0 10px 10px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.12);
          color: #111;
          margin-left: 2px;
        }
        .chat-bubble.outgoing::before {
          content: ''; position: absolute; top: 0; left: -7px;
          border: 7px solid transparent; border-top-color: #fff; border-right-color: #fff;
          border-radius: 0 2px 0 0;
        }
        .chat-time { font-size: 9px; color: #aaa; text-align: left; margin-top: 1px; display: flex; align-items: center; justify-content: flex-end; gap: 3px; }
        .chat-ticks { color: #53BDEB; font-size: 9px; }

        /* Typing indicator */
        .chat-typing {
          display: flex; align-items: center; gap: 3px;
          background: #fff; align-self: flex-start;
          padding: 10px 13px; border-radius: 10px 0 10px 10px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.12);
          margin-left: 2px; position: relative;
        }
        .chat-typing::before {
          content: ''; position: absolute; top: 0; left: -7px;
          border: 7px solid transparent; border-top-color: #fff; border-right-color: #fff;
          border-radius: 0 2px 0 0;
        }
        .typing-dot { width: 7px; height: 7px; border-radius: 50%; background: #B0B0B0; animation: typing-bounce 1.4s ease infinite; }
        .typing-dot:nth-child(2) { animation-delay: 0.18s; }
        .typing-dot:nth-child(3) { animation-delay: 0.36s; }
        @keyframes typing-bounce { 0%,60%,100% { transform: translateY(0) scale(0.85); opacity:0.5; } 30% { transform: translateY(-5px) scale(1); opacity:1; } }

        /* Input bar */
        .phone-wa-input { background: #F0F0F0; padding: 7px 10px; display: flex; align-items: center; gap: 7px; }
        .phone-wa-input-box { flex: 1; background: #fff; border-radius: 22px; padding: 7px 12px; font-size: 11px; color: #999; display: flex; align-items: center; gap: 6px; }
        .phone-wa-input-icon { color: #999; font-size: 13px; }
        .phone-wa-send { width: 34px; height: 34px; border-radius: 50%; background: #128C7E; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 6px rgba(18,140,126,0.35); }

        /* Chat animation classes — bubbles pop in with a subtle scale from their tail corner */
        .chat-bubble { opacity: 0; transform: translateY(8px) scale(0.9); transition: opacity 0.3s ease, transform 0.34s cubic-bezier(0.22, 1, 0.36, 1); }
        .chat-bubble.incoming { transform-origin: top right; }
        .chat-bubble.outgoing { transform-origin: top left; }
        .chat-typing { opacity: 0; transform: translateY(6px) scale(0.92); transition: opacity 0.22s ease, transform 0.22s ease; transform-origin: top left; }
        .chat-bubble.show, .chat-typing.show { opacity: 1; transform: none; }
        /* Header live "typing…" state */
        .phone-wa-online.is-typing { color: #25D366; }
        .phone-wa-online.is-typing::after { content: ''; display: inline-block; width: 3px; height: 3px; border-radius: 50%; background: currentColor; margin-inline-start: 3px; animation: typingDotHeader 1s steps(3) infinite; box-shadow: 5px 0 0 currentColor, 10px 0 0 currentColor; }
        @keyframes typingDotHeader { 0% { opacity: 0.2; } 50% { opacity: 1; } 100% { opacity: 0.2; } }

        /* BUTTONS */
        .btn-green { background: #25D366; color: #fff; font-size: 15px; font-weight: 700; padding: 13px 28px; border-radius: 10px; text-decoration: none; transition: opacity 0.15s, transform 0.15s, box-shadow 0.15s; box-shadow: 0 4px 14px rgba(37,211,102,0.35); display: inline-block; }
        .btn-green:hover { opacity: 0.9; transform: translateY(-2px); box-shadow: 0 8px 20px rgba(37,211,102,0.4); }
        .btn-outline { background: transparent; color: #444; font-size: 15px; font-weight: 500; padding: 13px 22px; border-radius: 10px; border: 1px solid #DDD; text-decoration: none; transition: border-color 0.15s, background 0.15s, transform 0.15s; display: inline-block; }
        .btn-outline:hover { border-color: #aaa; background: #FAFAFA; transform: translateY(-1px); }

        /* WAVE DIVIDERS */
        .wave { line-height: 0; display: block; }
        .wave svg { display: block; width: 100%; }

        /* MARQUEE */
        .lp-marquee { background: #0A0A0A; padding: 16px 0; overflow: hidden; }
        .marquee-track { display: flex; gap: 0; animation: marquee-scroll 28s linear infinite; white-space: nowrap; width: max-content; }
        .marquee-track:hover { animation-play-state: paused; }
        @keyframes marquee-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .marquee-item { display: inline-flex; align-items: center; gap: 10px; padding: 0 36px; font-size: 14px; color: rgba(255,255,255,0.72); font-weight: 500; border-right: 1px solid rgba(255,255,255,0.1); }
        .marquee-item .star { color: #F59E0B; font-size: 11px; }
        .marquee-item strong { color: rgba(255,255,255,0.9); }

        /* 3D PRODUCT */
        .lp-3d-wrap { background: #F8F8F8; padding: 0 24px 100px; overflow: hidden; }
        .lp-3d-inner { max-width: 1000px; margin: 0 auto; will-change: transform, opacity; transform-origin: center top; transform: perspective(1500px) rotateX(28deg) scale(0.88); opacity: 0.55; }
        .mock { background: #18181B; border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 40px 100px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.04); direction: ltr; }
        .mock-titlebar { background: #111; padding: 14px 20px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid rgba(255,255,255,0.07); direction: ltr; }
        .mock-dot { width: 11px; height: 11px; border-radius: 50%; }
        .mock-dot.r { background: #FF5F57; } .mock-dot.y { background: #FEBC2E; } .mock-dot.g { background: #28C840; }
        .mock-url { margin: 0 auto; background: #1E1E1E; border: 1px solid rgba(255,255,255,0.07); border-radius: 6px; padding: 5px 20px; font-size: 11px; color: #666; font-family: 'Courier New', monospace; }
        .mock-body { display: grid; grid-template-columns: 220px 1fr; direction: ltr; }
        .mock-sidebar { background: #111; border-right: 1px solid rgba(255,255,255,0.06); padding: 24px 14px; display: flex; flex-direction: column; gap: 3px; }
        .mock-sidebar-header { font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.25); letter-spacing: 0.12em; text-transform: uppercase; padding: 0 10px; margin-bottom: 12px; }
        .mock-nav-item { padding: 9px 14px; border-radius: 8px; font-size: 12.5px; color: #666; cursor: default; display: flex; align-items: center; gap: 10px; transition: background 0.12s; }
        .mock-nav-item.active { background: rgba(245,158,11,0.12); color: #F59E0B; font-weight: 600; }
        .mock-nav-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
        .mock-main { padding: 32px; }
        .mock-main-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
        .mock-main-title { font-size: 15px; font-weight: 700; color: #fff; }
        .mock-main-badge { background: rgba(37,211,102,0.12); color: #25D366; border: 1px solid rgba(37,211,102,0.2); font-size: 10px; font-weight: 600; padding: 3px 10px; border-radius: 20px; }
        .mock-stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 28px; }
        .mock-stat { background: #1E1E1E; border-radius: 12px; padding: 20px 22px; border: 1px solid rgba(255,255,255,0.07); position: relative; overflow: hidden; }
        .mock-stat::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 28px; opacity: 0.15; }
        .mock-stat-trend { font-size: 10px; color: #25D366; margin-top: 6px; }
        .mock-stat-trend.up { color: #25D366; }
        .mock-stat-trend.down { color: #EF4444; }
        .mock-stat-n { font-size: 26px; font-weight: 800; color: #fff; letter-spacing: -1px; margin-bottom: 4px; line-height: 1; }
        .mock-stat-n .g { color: #F59E0B; }
        .mock-stat-l { font-size: 11.5px; color: rgba(255,255,255,0.45); }
        .mock-section-title { font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.35); margin-bottom: 12px; letter-spacing: 0.1em; text-transform: uppercase; }
        .mock-appt-list { display: flex; flex-direction: column; gap: 8px; }
        .mock-appt { background: #1E1E1E; border-radius: 10px; padding: 13px 18px; display: flex; align-items: center; gap: 14px; border: 1px solid rgba(255,255,255,0.06); }
        .mock-appt-time { font-size: 12px; color: rgba(255,255,255,0.5); font-family: 'Courier New', monospace; flex-shrink: 0; font-weight: 600; min-width: 38px; }
        .mock-appt-name { font-size: 13px; color: #e8e8e8; flex: 1; font-weight: 500; }
        .mock-appt-service { font-size: 11px; color: rgba(255,255,255,0.38); }
        .mock-appt-badge { font-size: 10px; font-weight: 700; padding: 3px 10px; border-radius: 6px; flex-shrink: 0; }
        .mock-appt-badge.confirmed { background: rgba(37,211,102,0.1); color: #25D366; border: 1px solid rgba(37,211,102,0.2); }
        .mock-appt-badge.pending { background: rgba(245,158,11,0.1); color: #F59E0B; border: 1px solid rgba(245,158,11,0.2); }

        /* TRUST BAR */
        .lp-trust { background: #fff; padding: 28px 40px; display: flex; align-items: center; justify-content: center; gap: 32px; flex-wrap: wrap; overflow-x: auto; }
        .lp-trust-label { font-size: 11px; color: #999; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; }
        .lp-trust-items { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .lp-trust-item { display: flex; align-items: center; gap: 9px; font-size: 13px; color: #222; font-weight: 600; background: #F7F7F7; border: 1px solid #E8E8E8; border-radius: 10px; padding: 8px 16px; transition: border-color 0.15s, box-shadow 0.15s; }
        .lp-trust-item:hover { border-color: #D0D0D0; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }

        /* SECTION LABELS */
        .lp-label { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #25D366; margin-bottom: 12px; }
        .lp-title { font-size: clamp(28px, 3.5vw, 44px); font-weight: 800; letter-spacing: -1.5px; color: #0A0A0A; margin-bottom: 56px; line-height: 1.1; }

        /* STATS BAND */
        .lp-stats-band { background: #0A0A0A; padding: 72px 40px; }
        .lp-stats-band-inner { max-width: 1080px; margin: 0 auto; display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
        .lp-stat-cell { padding: 48px 36px; background: #141414; border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; }
        .lp-stat-n { font-size: 52px; font-weight: 800; letter-spacing: -3px; line-height: 1; color: #fff; margin-bottom: 6px; font-variant-numeric: tabular-nums; display: flex; align-items: flex-end; gap: 2px; }
        .lp-stat-n .accent { color: #F59E0B; font-size: 32px; padding-bottom: 6px; }
        .lp-stat-n .count-up { display: inline-block; }
        .lp-stat-l { font-size: 14px; color: rgba(255,255,255,0.72); line-height: 1.5; }

        /* INTEGRATION FLOW */
        .lp-flow { padding: 100px 40px; background: #fff; }
        .lp-flow-inner { max-width: 900px; margin: 0 auto; }
        .lp-flow-steps { display: flex; align-items: center; justify-content: center; gap: 0; margin-top: 52px; flex-wrap: nowrap; }
        .lp-flow-node { display: flex; flex-direction: column; align-items: center; gap: 14px; flex: 1; }
        .lp-flow-icon { width: 80px; height: 80px; border-radius: 22px; display: flex; align-items: center; justify-content: center; font-size: 32px; position: relative; transition: transform 0.2s, box-shadow 0.2s; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
        .lp-flow-node:hover .lp-flow-icon { transform: scale(1.08) translateY(-4px); box-shadow: 0 10px 28px rgba(0,0,0,0.12); }
        .lp-flow-icon.wa { background: linear-gradient(135deg, #E8FFF0, #C8F7D8); border: 2px solid #86EFAC; }
        .lp-flow-icon.ai { background: linear-gradient(135deg, #F0F0FF, #B3E4F2); border: 2px solid #A5B4FC; }
        .lp-flow-icon.cal { background: linear-gradient(135deg, #FFF8E8, #FEF3C7); border: 2px solid #FCD34D; }
        .lp-flow-icon.phone { background: linear-gradient(135deg, #FFF0F0, #FEE2E2); border: 2px solid #FCA5A5; }
        .lp-flow-label { font-size: 14px; font-weight: 700; color: #111; text-align: center; }
        .lp-flow-sub { font-size: 12px; color: #666; text-align: center; max-width: 110px; line-height: 1.45; }
        .lp-flow-arrow { flex-shrink: 0; width: 40px; color: #BBB; font-size: 24px; text-align: center; padding-bottom: 40px; }
        .lp-flow-ping { position: absolute; top: -4px; right: -4px; width: 12px; height: 12px; border-radius: 50%; }
        .lp-flow-ping.green { background: #25D366; animation: ping 2s ease infinite; }
        .lp-flow-ping.blue { background: #6366F1; animation: ping 2s ease 0.5s infinite; }
        .lp-flow-ping.amber { background: #F59E0B; animation: ping 2s ease 1s infinite; }
        .lp-flow-ping.red { background: #EF4444; animation: ping 2s ease 1.5s infinite; }
        @keyframes ping { 0% { transform: scale(1); opacity: 1; } 75%,100% { transform: scale(2.2); opacity: 0; } }

        /* HOW IT WORKS */
        .lp-steps { padding: 100px 40px; max-width: 1080px; margin: 0 auto; background: #F8F8F8; }
        .lp-steps-grid { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid #E8E8E8; border-radius: 14px; overflow: hidden; }
        .lp-step { padding: 40px 34px; background: #fff; border-left: 1px solid #EBEBEB; transition: background 0.2s; }
        .lp-step:hover { background: #FAFAFA; }
        .lp-step:last-child { border-left: none; }
        .lp-step-num { font-size: 12px; font-weight: 700; color: #25D366; margin-bottom: 20px; letter-spacing: 0.06em; }
        .lp-step-title { font-size: 16px; font-weight: 700; color: #111; margin-bottom: 10px; letter-spacing: -0.3px; line-height: 1.35; }
        .lp-step-desc { font-size: 16px; color: #666; line-height: 1.7; }

        /* FEATURES */
        .lp-features { background: #F8F8F8; padding: 100px 40px; }
        .lp-features-inner { max-width: 1080px; margin: 0 auto; }
        .lp-feats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 52px; }
        .lp-feat { background: #fff; border: 1px solid #E8E8E8; border-radius: 12px; padding: 28px 24px; transition: transform 0.18s ease, box-shadow 0.18s ease; cursor: default; transform-style: preserve-3d; }
        .lp-feat:hover { box-shadow: 0 16px 40px rgba(0,0,0,0.08); }
        .lp-feat-icon { width: 42px; height: 42px; border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; font-size: 20px; background: #F0FFF4; }
        .lp-feat-title { font-size: 15px; font-weight: 700; color: #111; margin-bottom: 7px; letter-spacing: -0.2px; }
        .lp-feat-desc { font-size: 16px; color: #666; line-height: 1.65; }

        /* TESTIMONIALS */
        .lp-testi { padding: 100px 40px; background: #fff; }
        .lp-testi-inner { max-width: 1080px; margin: 0 auto; }
        .lp-testi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 52px; }
        .lp-testi-card { background: #FAFAFA; border: 1px solid #E8E8E8; border-radius: 14px; padding: 28px; display: flex; flex-direction: column; gap: 20px; transition: transform 0.2s, box-shadow 0.2s; }
        .lp-testi-card:hover { transform: translateY(-4px); box-shadow: 0 16px 40px rgba(0,0,0,0.07); }
        .lp-testi-stars { display: flex; gap: 2px; }
        .lp-testi-star { color: #F59E0B; font-size: 14px; }
        .lp-testi-quote { font-size: 16px; color: #333; line-height: 1.7; flex: 1; }
        .lp-testi-footer { display: flex; align-items: center; gap: 12px; padding-top: 16px; border-top: 1px solid #E8E8E8; }
        .lp-testi-avatar { width: 38px; height: 38px; border-radius: 50%; font-size: 15px; font-weight: 700; color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .lp-testi-name { font-size: 13px; font-weight: 700; color: #111; }
        .lp-testi-role { font-size: 12px; color: #888; }

        /* BEFORE/AFTER */
        .lp-ba { background: #0A0A0A; padding: 100px 40px; }
        .lp-ba-inner { max-width: 1080px; margin: 0 auto; }
        .lp-ba .lp-label { color: #F59E0B; }
        .lp-ba .lp-title { color: #fff; }
        .lp-ba-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 52px; }
        .lp-ba-card { border-radius: 16px; padding: 36px; border: 1px solid transparent; }
        .lp-ba-card.before { background: rgba(239,68,68,0.06); border-color: rgba(239,68,68,0.2); }
        .lp-ba-card.after { background: rgba(37,211,102,0.06); border-color: rgba(37,211,102,0.25); }
        .lp-ba-header { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
        .lp-ba-icon { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
        .before .lp-ba-icon { background: rgba(239,68,68,0.12); }
        .after .lp-ba-icon { background: rgba(37,211,102,0.12); }
        .lp-ba-tag { font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
        .before .lp-ba-tag { color: #F87171; }
        .after .lp-ba-tag { color: #4ADE80; }
        .lp-ba-items { display: flex; flex-direction: column; gap: 16px; }
        .lp-ba-item { display: flex; align-items: flex-start; gap: 12px; font-size: 16px; line-height: 1.6; color: rgba(255,255,255,0.75); }
        .lp-ba-bullet { font-size: 14px; margin-top: 1px; flex-shrink: 0; font-weight: 700; }
        .before .lp-ba-bullet { color: #F87171; }
        .after .lp-ba-bullet { color: #4ADE80; }

        /* PREMIUM */
        .lp-premium { background: #0A0A0A; padding: 100px 40px; position: relative; overflow: hidden; }
        .lp-premium::before { content: ''; position: absolute; top: -120px; right: -120px; width: 500px; height: 500px; border-radius: 50%; background: radial-gradient(circle, rgba(245,158,11,0.06) 0%, transparent 70%); pointer-events: none; }
        .lp-premium-inner { max-width: 1080px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: center; }
        .lp-premium-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.25); color: #F59E0B; font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 20px; margin-bottom: 18px; letter-spacing: 0.08em; text-transform: uppercase; }
        .lp-premium-title { font-size: clamp(28px, 3vw, 42px); font-weight: 800; color: #fff; letter-spacing: -1.5px; line-height: 1.1; margin-bottom: 16px; }
        .lp-premium-title .amber { color: #F59E0B; }
        .lp-premium-desc { font-size: 16px; color: rgba(255,255,255,0.72); line-height: 1.75; margin-bottom: 28px; }
        .lp-premium-note { display: inline-flex; align-items: center; gap: 8px; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.3); border-radius: 8px; padding: 10px 16px; font-size: 13px; color: rgba(255,255,255,0.72); margin-bottom: 32px; }
        .lp-premium-note strong { color: #F59E0B; }
        .btn-amber { display: inline-flex; align-items: center; gap: 8px; background: #F59E0B; color: #000; font-size: 14px; font-weight: 700; padding: 12px 24px; border-radius: 9px; text-decoration: none; transition: opacity 0.15s, transform 0.15s, box-shadow 0.15s; box-shadow: 0 4px 16px rgba(245,158,11,0.3); }
        .btn-amber:hover { opacity: 0.88; transform: translateY(-2px); box-shadow: 0 8px 24px rgba(245,158,11,0.4); }
        .voice-card { background: #141414; border: 1px solid rgba(255,255,255,0.07); border-radius: 14px; overflow: hidden; }
        .voice-card-header { padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; gap: 10px; }
        .voice-live-dot { width: 8px; height: 8px; border-radius: 50%; background: #F59E0B; flex-shrink: 0; animation: pulse-amber 2s infinite; }
        @keyframes pulse-amber { 0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(245,158,11,0.4); } 50% { opacity: 0.7; box-shadow: 0 0 0 4px rgba(245,158,11,0); } }
        .voice-card-title { font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.88); }
        .voice-card-duration { font-size: 11px; color: rgba(255,255,255,0.5); font-family: 'Courier New', monospace; margin-right: auto; }
        .voice-waveform { padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; gap: 3px; height: 56px; }
        .vbar { width: 3px; border-radius: 2px; background: #F59E0B; flex-shrink: 0; animation: vwave 1.4s ease-in-out infinite; transform-origin: bottom; }
        .vbar:nth-child(1)  { height: 10px; animation-delay: 0s; }    .vbar:nth-child(2)  { height: 22px; animation-delay: 0.08s; }
        .vbar:nth-child(3)  { height: 30px; animation-delay: 0.16s; } .vbar:nth-child(4)  { height: 18px; animation-delay: 0.24s; }
        .vbar:nth-child(5)  { height: 36px; animation-delay: 0.12s; } .vbar:nth-child(6)  { height: 14px; animation-delay: 0.2s; }
        .vbar:nth-child(7)  { height: 28px; animation-delay: 0.06s; } .vbar:nth-child(8)  { height: 40px; animation-delay: 0.14s; }
        .vbar:nth-child(9)  { height: 20px; animation-delay: 0.22s; } .vbar:nth-child(10) { height: 32px; animation-delay: 0.1s; }
        .vbar:nth-child(11) { height: 16px; animation-delay: 0.18s; } .vbar:nth-child(12) { height: 24px; animation-delay: 0.04s; }
        .vbar:nth-child(13) { height: 38px; animation-delay: 0.28s; } .vbar:nth-child(14) { height: 12px; animation-delay: 0.32s; }
        .vbar:nth-child(15) { height: 8px;  animation-delay: 0.36s; }
        @keyframes vwave { 0%, 100% { transform: scaleY(1); opacity: 0.9; } 50% { transform: scaleY(0.25); opacity: 0.4; } }
        .voice-transcript { padding: 16px 20px; display: flex; flex-direction: column; gap: 14px; }
        .vline { font-size: 12px; line-height: 1.5; }
        .vspeaker { font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 2px; }
        .vspeaker.caller { color: rgba(255,255,255,0.5); }
        .vspeaker.ai { color: #F59E0B; }
        .vline.caller-l { color: rgba(255,255,255,0.72); }
        .vline.ai-l { color: #fff; font-weight: 500; }

        /* PRICING */
        .lp-pricing { padding: 100px 40px; background: #fff; }
        .lp-pricing-inner { max-width: 860px; margin: 0 auto; }
        .lp-pricing-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 52px; }
        .lp-plan { border-radius: 16px; padding: 36px; border: 1px solid #E8E8E8; position: relative; transition: box-shadow 0.2s; }
        .lp-plan:hover { box-shadow: 0 16px 48px rgba(0,0,0,0.08); }
        .lp-plan.featured { border-color: #111; background: #0A0A0A; }
        .lp-plan-tag { position: absolute; top: -12px; right: 28px; background: #25D366; color: #fff; font-size: 11px; font-weight: 700; padding: 3px 12px; border-radius: 20px; letter-spacing: 0.05em; }
        .lp-plan.featured .lp-plan-tag { background: #F59E0B; color: #000; }
        .lp-plan-name { font-size: 14px; font-weight: 700; color: #111; margin-bottom: 8px; letter-spacing: -0.2px; }
        .lp-plan.featured .lp-plan-name { color: #fff; }
        .lp-plan-price { font-size: 52px; font-weight: 800; letter-spacing: -2.5px; color: #111; line-height: 1; margin-bottom: 4px; }
        .lp-plan.featured .lp-plan-price { color: #fff; }
        .lp-plan-per { font-size: 13px; color: #888; margin-bottom: 28px; }
        .lp-plan.featured .lp-plan-per { color: rgba(255,255,255,0.6); }
        .lp-plan-divider { height: 1px; background: #EBEBEB; margin-bottom: 24px; }
        .lp-plan.featured .lp-plan-divider { background: rgba(255,255,255,0.08); }
        .lp-plan-features { display: flex; flex-direction: column; gap: 12px; margin-bottom: 32px; }
        .lp-plan-feat { display: flex; align-items: flex-start; gap: 10px; font-size: 16px; color: #444; line-height: 1.5; }
        .lp-plan.featured .lp-plan-feat { color: rgba(255,255,255,0.82); }
        .lp-plan-feat .check { color: #25D366; font-size: 13px; flex-shrink: 0; margin-top: 1px; }
        .lp-plan.featured .lp-plan-feat .check { color: #F59E0B; }
        .lp-plan-btn { display: block; text-align: center; padding: 13px; border-radius: 10px; font-size: 14px; font-weight: 700; text-decoration: none; transition: opacity 0.15s, transform 0.15s; }
        .lp-plan-btn.dark { background: #111; color: #fff; }
        .lp-plan-btn.dark:hover { opacity: 0.8; transform: translateY(-1px); }
        .lp-plan-btn.amber { background: #F59E0B; color: #000; box-shadow: 0 4px 14px rgba(245,158,11,0.3); }
        .lp-plan-btn.amber:hover { opacity: 0.88; transform: translateY(-2px); }

        /* ROI CALCULATOR */
        /* LIVE DEMO */
        .lp-demo { padding: 100px 40px; background: #fff; }
        .lp-demo-inner { max-width: 620px; margin: 0 auto; }
        .lp-demo-chat { background: #fff; border: 1px solid #E8E8E8; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.1); }
        .lp-demo-header { display: flex; align-items: center; gap: 12px; padding: 14px 18px; background: #0D2A38; }
        .lp-demo-avatar { width: 42px; height: 42px; border-radius: 50%; overflow: hidden; background: #fff; flex-shrink: 0; box-shadow: 0 0 0 2px rgba(37,211,102,0.3); }
        .lp-demo-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .lp-demo-name { font-size: 15px; font-weight: 700; color: #fff; }
        .lp-demo-status { font-size: 12px; color: #25D366; margin-top: 1px; }
        .lp-demo-body { background: #E5DDD5; padding: 20px 16px; height: 340px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
        .lp-demo-bubble { max-width: 80%; padding: 9px 13px; font-size: 14px; line-height: 1.5; border-radius: 12px; box-shadow: 0 1px 1px rgba(0,0,0,0.1); word-break: break-word; }
        .lp-demo-bubble.bot { background: #fff; align-self: flex-start; border-top-left-radius: 2px; color: #111; }
        .lp-demo-bubble.user { background: #DCF8C6; align-self: flex-end; border-top-right-radius: 2px; color: #111; }
        .lp-demo-input { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: #F0F0F0; }
        .lp-demo-input input { flex: 1; border: none; border-radius: 22px; padding: 11px 16px; font-size: 14px; outline: none; font-family: inherit; background: #fff; color: #111; }
        .lp-demo-input button { width: 42px; height: 42px; border-radius: 50%; border: none; background: #25D366; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: transform 0.12s, background 0.15s; }
        .lp-demo-input button:hover { background: #20c45a; transform: scale(1.05); }
        @media (max-width: 900px) { .lp-demo { padding: 72px 20px; } }

        .lp-roi { padding: 100px 40px; background: #0A0A0A; }
        .lp-roi-inner { max-width: 700px; margin: 0 auto; text-align: center; }
        .lp-roi .lp-label { color: #F59E0B; }
        .lp-roi .lp-title { color: #fff; margin-bottom: 16px; }
        .lp-roi-sub { font-size: 16px; color: rgba(255,255,255,0.65); margin-bottom: 48px; }
        .lp-roi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 36px; }
        .lp-roi-cell { padding: 28px 20px; background: #141414; border: 1px solid rgba(255,255,255,0.07); border-radius: 14px; text-align: center; }
        .lp-roi-n { font-size: 36px; font-weight: 800; letter-spacing: -2px; color: #fff; margin-bottom: 4px; font-variant-numeric: tabular-nums; }
        .lp-roi-n .accent { color: #25D366; }
        .lp-roi-n .amber { color: #F59E0B; }
        .lp-roi-l { font-size: 13.5px; color: rgba(255,255,255,0.72); line-height: 1.5; }
        .lp-roi-note { font-size: 14px; color: rgba(255,255,255,0.6); }
        .lp-roi-note strong { color: #fff; }

        /* FAQ */
        .lp-faq { padding: 100px 40px; background: #F8F8F8; }
        .lp-faq-inner { max-width: 720px; margin: 0 auto; }
        .lp-faq-list { display: flex; flex-direction: column; gap: 0; margin-top: 52px; border: 1px solid #E8E8E8; border-radius: 14px; overflow: hidden; }
        .faq-item { background: #fff; border-bottom: 1px solid #EBEBEB; }
        .faq-item:last-child { border-bottom: none; }
        .faq-q { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px; cursor: pointer; font-size: 16px; font-weight: 600; color: #111; transition: background 0.15s; user-select: none; }
        .faq-q:hover { background: #FAFAFA; }
        .faq-icon { width: 20px; height: 20px; border-radius: 50%; background: #F0F0F0; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #555; flex-shrink: 0; transition: transform 0.25s ease, background 0.15s; font-style: normal; }
        .faq-item.open .faq-icon { background: #25D366; color: #fff; }
        .faq-a { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
        .faq-a-inner { padding: 0 24px 20px; font-size: 16px; color: #555; line-height: 1.75; }

        /* CTA */
        .lp-cta { background: #fff; padding: 120px 40px; text-align: center; }
        .lp-cta-title { font-size: clamp(28px, 4.5vw, 56px); font-weight: 800; letter-spacing: -2.5px; color: #0A0A0A; margin-bottom: 12px; line-height: 1.05; }
        .lp-cta-sub { font-size: 17px; color: #888; margin-bottom: 36px; }
        .lp-cta-row { display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; }
        .lp-cta-trust { display: flex; align-items: center; justify-content: center; gap: 20px; margin-top: 28px; flex-wrap: wrap; }
        .lp-cta-trust-item { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: #AAA; }

        /* FOOTER */
        .lp-footer { background: #0A0A0A; padding: 64px 44px 36px; }
        .lp-footer-top { display: grid; grid-template-columns: 1.7fr 1fr 1fr 1.5fr; gap: 48px; margin-bottom: 44px; align-items: start; max-width: 1200px; }
        .lp-footer-brand-block { max-width: 300px; }
        .lp-footer-logo-row { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
        .lp-footer-logo-row img { width: 30px; height: 30px; border-radius: 7px; opacity: 0.95; }
        .lp-footer-brand { font-size: 16px; font-weight: 700; color: #fff; }
        .lp-footer-tagline { font-size: 14px; color: rgba(255,255,255,0.62); line-height: 1.7; }
        .lp-footer-col h4 { font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.4); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 16px; }
        .lp-footer-col a { display: block; font-size: 14px; color: rgba(255,255,255,0.65); text-decoration: none; margin-bottom: 11px; transition: color 0.15s; }
        .lp-footer-col a:hover { color: #25D366; }
        /* "Suitable for" uses a compact 2-column list so the many business types stay tidy */
        .lp-footer-suitable { display: grid; grid-template-columns: 1fr 1fr; column-gap: 28px; }
        .lp-footer-bottom { display: flex; align-items: center; justify-content: space-between; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.08); flex-wrap: wrap; gap: 12px; }
        .lp-footer-copy { font-size: 12.5px; color: rgba(255,255,255,0.45); }
        .lp-footer-copy-link { color: rgba(255,255,255,0.65); text-decoration: underline; text-underline-offset: 2px; }
        .lp-footer-copy-link:hover { color: #25D366; }

        /* ANIMATIONS */
        @keyframes fadeUp { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: none; } }
        @keyframes fadeDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: none; } }
        .reveal { opacity: 0; transform: translateY(22px); transition: opacity 0.6s ease, transform 0.6s ease; }
        .reveal.in { opacity: 1; transform: none; }
        .reveal.d1 { transition-delay: 0.08s; } .reveal.d2 { transition-delay: 0.16s; } .reveal.d3 { transition-delay: 0.24s; }
        .reveal.d4 { transition-delay: 0.08s; } .reveal.d5 { transition-delay: 0.16s; } .reveal.d6 { transition-delay: 0.24s; }

        /* RESPONSIVE */
        @media (max-width: 1000px) {
          .lp-hero { grid-template-columns: 1fr; text-align: center; padding: 40px 24px 0; justify-items: center; }
          .lp-hero-text { padding: 60px 0 20px; }
          .lp-h1 { max-width: 100%; }
          .lp-hero-sub { max-width: 100%; }
          .lp-hero-ctas { justify-content: center; }
          .lp-hero-phone { display: none; }
        }
        @media (max-width: 900px) {
          .lp-nav { padding: 0 20px; }
          .lp-nav-links { display: none; }
          .hamburger-btn { display: flex; }
          .lp-nav-cta { display: none; }
          #hero-toast { display: none; }
          .mock-body { grid-template-columns: 1fr; }
          .mock-sidebar { display: none; }
          .lp-steps { padding: 72px 20px; }
          .lp-steps-grid { grid-template-columns: 1fr; }
          .lp-step { border-left: none; border-bottom: 1px solid #EBEBEB; }
          .lp-step:last-child { border-bottom: none; }
          .lp-features { padding: 72px 20px; }
          .lp-feats-grid { grid-template-columns: 1fr 1fr; gap: 12px; }
          .lp-testi { padding: 72px 20px; }
          .lp-testi-grid { grid-template-columns: 1fr; }
          .lp-ba { padding: 72px 20px; }
          .lp-ba-grid { grid-template-columns: 1fr; }
          .lp-premium { padding: 72px 20px; }
          .lp-premium-inner { grid-template-columns: 1fr; gap: 48px; }
          .lp-pricing { padding: 72px 20px; }
          .lp-pricing-grid { grid-template-columns: 1fr; }
          .lp-faq { padding: 72px 20px; }
          .lp-cta { padding: 72px 20px; }
          .lp-footer { padding: 32px 20px; }
          .lp-footer-top { grid-template-columns: 1fr 1fr; gap: 32px; }
          .lp-footer-brand-block { grid-column: 1 / -1; }
          .lp-stats-band { padding: 40px 20px; }
          .lp-stats-band-inner { grid-template-columns: 1fr 1fr; }
          .lp-flow { padding: 72px 20px; }
          .lp-flow-steps { gap: 0; }
          .lp-flow-arrow { width: 20px; font-size: 16px; }
          .lp-roi { padding: 72px 20px; }
          .lp-roi-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 540px) {
          .lp-feats-grid { grid-template-columns: 1fr; }
          .lp-stats-band-inner { grid-template-columns: 1fr 1fr; }
          .lp-flow-steps { flex-direction: column; gap: 16px; }
          .lp-flow-arrow { transform: rotate(90deg); padding: 0; width: 40px; }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
          .lp-3d-inner { transform: none !important; opacity: 1 !important; }
          .chat-bubble, .chat-typing { opacity: 1 !important; transform: none !important; }
        }

        /* HAMBURGER NAV */
        .hamburger-btn { display: none; flex-direction: column; justify-content: center; gap: 5px; width: 36px; height: 36px; background: none; border: none; cursor: pointer; padding: 6px; border-radius: 8px; transition: background 0.15s; }
        .hamburger-btn:hover { background: #F5F5F5; }
        .hamburger-btn span { display: block; width: 18px; height: 2px; background: #111; border-radius: 2px; transition: transform 0.25s ease, opacity 0.2s; }
        .hamburger-btn.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
        .hamburger-btn.open span:nth-child(2) { opacity: 0; }
        .hamburger-btn.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }
        #mobile-nav {
          position: fixed; top: 62px; left: 0; right: 0; z-index: 190;
          background: rgba(255,255,255,0.98); backdrop-filter: blur(20px);
          border-bottom: 1px solid #EBEBEB;
          display: flex; flex-direction: column; gap: 2px; padding: 12px 16px 16px;
          transform: translateY(-8px); opacity: 0; pointer-events: none;
          transition: transform 0.22s ease, opacity 0.22s ease;
        }
        #mobile-nav.open { transform: none; opacity: 1; pointer-events: auto; }
        .mobile-nav-link { font-size: 15px; font-weight: 500; color: #333; text-decoration: none; padding: 11px 14px; border-radius: 10px; transition: background 0.12s, color 0.12s; }
        .mobile-nav-link:hover { background: #F5F5F5; color: #111; }
        .mobile-nav-divider { height: 1px; background: #EBEBEB; margin: 6px 0; }
        .mobile-nav-cta { display: block; text-align: center; background: #111; color: #fff; font-size: 14px; font-weight: 700; padding: 13px; border-radius: 10px; text-decoration: none; margin-top: 4px; }

        /* HERO NOTIFICATION TOAST */
        #hero-toast {
          margin-top: 20px;
          background: #fff; border: 1px solid #E8E8E8; border-radius: 14px;
          padding: 12px 16px; display: flex; align-items: center; gap: 12px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06);
          min-width: 240px; max-width: 300px;
          opacity: 0; transform: translateY(10px);
          transition: opacity 0.4s ease, transform 0.4s ease;
          pointer-events: none;
        }
        #hero-toast.ht-in { opacity: 1; transform: none; }
        #hero-toast.ht-out { opacity: 0; transform: translateY(-6px); }
        .ht-icon-wrap { width: 36px; height: 36px; border-radius: 10px; background: #F0FFF4; border: 1px solid #BBF7D0; display: flex; align-items: center; justify-content: center; font-size: 17px; flex-shrink: 0; }
        .ht-icon { font-size: 17px; }
        .ht-msg { font-size: 12.5px; font-weight: 700; color: #111; line-height: 1.3; }
        .ht-sub { font-size: 11px; color: #777; margin-top: 1px; line-height: 1.3; }
        .ht-live { display: flex; align-items: center; gap: 4px; margin-right: auto; }
        .ht-dot { width: 6px; height: 6px; border-radius: 50%; background: #25D366; animation: pulse-green 2s infinite; flex-shrink: 0; }
        .ht-live-label { font-size: 9px; font-weight: 700; color: #25D366; letter-spacing: 0.06em; text-transform: uppercase; }

        /* COMPARISON TABLE */
        .lp-compare { padding: 100px 40px; background: #fff; border-top: 1px solid #EBEBEB; }
        .lp-compare-inner { max-width: 860px; margin: 0 auto; }
        .compare-table { width: 100%; border-collapse: collapse; margin-top: 52px; border: 1px solid #E8E8E8; border-radius: 14px; overflow: hidden; }
        .compare-table th { padding: 16px 20px; font-size: 13px; font-weight: 700; text-align: center; background: #F8F8F8; border-bottom: 1px solid #EBEBEB; }
        .compare-table th:first-child { text-align: right; width: 44%; }
        .compare-table th.col-tori { background: #1D4ED8; color: #fff; }
        .compare-table th.col-tori .col-badge { display: inline-block; background: #fff; color: #1D4ED8; font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 20px; margin-right: 6px; letter-spacing: 0.04em; vertical-align: middle; }
        .compare-table td { padding: 14px 20px; font-size: 15px; color: #444; border-bottom: 1px solid #F0F0F0; vertical-align: middle; }
        .compare-table tr:last-child td { border-bottom: none; }
        .compare-table td:first-child { font-weight: 500; color: #222; }
        .compare-table td { text-align: center; }
        .compare-table td:first-child { text-align: right; }
        .compare-table tbody tr:hover td { background: #FAFAFA; }
        .compare-table tbody tr:hover td.col-tori-cell { background: #DBEAFE; }
        .col-tori-cell { background: #EFF6FF; }
        .cmp-yes { color: #16A34A; font-size: 16px; font-weight: 700; }
        .cmp-no { color: #DC2626; font-size: 16px; }
        .cmp-partial { color: #D97706; font-size: 14px; font-weight: 600; }

        /* INTERACTIVE ROI SLIDER */
        .lp-roi-slider-wrap { margin: 40px 0 36px; }
        .roi-slider-label { font-size: 14px; color: rgba(255,255,255,0.7); margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; }
        .roi-slider-val { font-size: 22px; font-weight: 800; color: #25D366; letter-spacing: -1px; }
        .roi-slider {
          -webkit-appearance: none; appearance: none; width: 100%; height: 5px;
          border-radius: 4px; outline: none; cursor: pointer;
          background: rgba(255,255,255,0.12);
        }
        .roi-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 22px; height: 22px; border-radius: 50%; background: #25D366; box-shadow: 0 2px 8px rgba(37,211,102,0.4); cursor: pointer; transition: transform 0.15s; }
        .roi-slider::-webkit-slider-thumb:hover { transform: scale(1.15); }
        .roi-slider::-moz-range-thumb { width: 22px; height: 22px; border-radius: 50%; background: #25D366; border: none; cursor: pointer; }
      `}</style>


      <div id="scroll-bar" />

      {/* Sticky floating CTA */}
      <a id="sticky-cta" href="/login">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
        התחל חינם עכשיו
      </a>

      <div className="lp">

        {/* NAV */}
        <nav className="lp-nav">
          <a className="lp-nav-logo" href="#">
            <img src="/tori_logo_transparent.png" alt="תורי" style={{ width: 32, height: 32, borderRadius: 8 }} />
            <span>תורי</span>
          </a>
          <div className="lp-nav-links">
            <a className="lp-nav-link" href="#how">איך זה עובד</a>
            <a className="lp-nav-link" href="#features">תכונות</a>
            <a className="lp-nav-link" href="#premium">פרמיום</a>
            <a className="lp-nav-link" href="#demo">דמו חי</a>
            <a className="lp-nav-link" href="#roi">מחשבון חיסכון</a>
            <a className="lp-nav-link" href="#pricing">מחירים</a>
            <a className="lp-nav-link" href="#faq">FAQ</a>
          </div>
          <a className="lp-nav-link" href="/en" style={{ fontSize: 12, padding: "6px 10px", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 7 }}>🌐 EN</a>
          <a className="lp-nav-cta" href="/login">כניסה לדשבורד ←</a>
          <button id="hamburger-btn" className={`hamburger-btn${menuOpen ? " open" : ""}`} onClick={() => setMenuOpen(o => !o)} aria-label="תפריט">
            <span /><span /><span />
          </button>
        </nav>
        {/* Mobile nav drawer */}
        <div id="mobile-nav" className={menuOpen ? "open" : ""}>
          <a className="mobile-nav-link" href="#how" onClick={() => setMenuOpen(false)}>איך זה עובד</a>
          <a className="mobile-nav-link" href="#features" onClick={() => setMenuOpen(false)}>תכונות</a>
          <a className="mobile-nav-link" href="#premium" onClick={() => setMenuOpen(false)}>פרמיום</a>
          <a className="mobile-nav-link" href="#demo" onClick={() => setMenuOpen(false)}>דמו חי</a>
          <a className="mobile-nav-link" href="#roi" onClick={() => setMenuOpen(false)}>מחשבון חיסכון</a>
          <a className="mobile-nav-link" href="#pricing" onClick={() => setMenuOpen(false)}>מחירים</a>
          <a className="mobile-nav-link" href="#faq" onClick={() => setMenuOpen(false)}>שאלות נפוצות</a>
          <div className="mobile-nav-divider" />
          <a className="mobile-nav-cta" href="/login">כניסה לדשבורד ←</a>
        </div>

        {/* HERO — split layout */}
        <section style={{ background: "#fff", position: "relative" }}>
          <div className="lp-hero">
            {/* Left: text */}
            <div className="lp-hero-text">
              <div className="lp-kicker">
                <span className="lp-kicker-dot" />
                WhatsApp · Google Calendar · AI
              </div>
              <h1 className="lp-h1">
                העסק שלך קובע תורים<br />
                <span className="green">גם כשאתה ישן.</span>
              </h1>
              <p className="lp-hero-sub">
                בוט AI עונה ללקוחות בוואטסאפ, קובע תורים ומסנכרן הכל לגוגל קלנדר — בלי שנגעת בטלפון. בכלל.
              </p>
              <div className="lp-hero-ctas">
                <a className="btn-green" href="/login">נסה חינם — 14 יום</a>
                <a className="btn-outline" href="#how">איך זה עובד?</a>
              </div>
              <div className="lp-hero-types">
                {["💇 סלוני שיער","💅 ציפורניים","🏥 קליניקות","💆 עיסוי","🦷 שיניים","🐕 גרוומינג","🧖 אסתטיקה","🥊 כושר"].map((t) => (
                  <span key={t} className="lp-type-pill">{t}</span>
                ))}
              </div>
              {social && (
                <div className="lp-social-proof">
                  <div className="lp-social-dot" />
                  <span>
                    <strong>{social.businesses.toLocaleString()}</strong> עסקים כבר מקבלים תורים אוטומטית ·{" "}
                    <strong>{social.appointments.toLocaleString()}</strong> תורים נקבעו
                  </span>
                </div>
              )}
            </div>

            {/* Right: animated phone */}
            <div className="lp-hero-phone">
              <div className="phone-wrap">
                <div className="phone-frame">
                  <div className="phone-island">
                    <div className="phone-island-cam"><div className="phone-island-cam-inner" /></div>
                  </div>
                  <div className="phone-status-bar">
                    <span className="phone-status-time">9:41</span>
                    <div className="phone-status-icons">
                      {/* signal */}
                      <svg width="16" height="11" viewBox="0 0 16 11" fill="#111" aria-hidden>
                        <rect x="0" y="7" width="3" height="4" rx="0.6" />
                        <rect x="4.3" y="5" width="3" height="6" rx="0.6" />
                        <rect x="8.6" y="2.5" width="3" height="8.5" rx="0.6" />
                        <rect x="12.9" y="0" width="3" height="11" rx="0.6" />
                      </svg>
                      {/* wifi */}
                      <svg width="15" height="11" viewBox="0 0 15 11" fill="#111" aria-hidden>
                        <path d="M7.5 2C10.1 2 12.5 3 14.2 4.8l-1.3 1.3C11.5 4.7 9.6 3.9 7.5 3.9S3.5 4.7 2.1 6.1L0.8 4.8C2.5 3 4.9 2 7.5 2z" />
                        <path d="M7.5 5.4c1.6 0 3.1.6 4.2 1.7l-1.3 1.3c-.8-.8-1.8-1.2-2.9-1.2s-2.1.4-2.9 1.2L3.3 7.1C4.4 6 5.9 5.4 7.5 5.4z" />
                        <circle cx="7.5" cy="9.5" r="1.4" />
                      </svg>
                      {/* battery */}
                      <svg width="24" height="12" viewBox="0 0 24 12" fill="none" aria-hidden>
                        <rect x="0.5" y="1" width="20" height="10" rx="2.5" stroke="#111" strokeWidth="1" opacity="0.4" />
                        <rect x="2" y="2.5" width="17" height="7" rx="1.2" fill="#111" />
                        <rect x="21.5" y="4" width="1.6" height="4" rx="0.8" fill="#111" opacity="0.4" />
                      </svg>
                    </div>
                  </div>
                  <div className="phone-wa-bar">
                    <div className="phone-wa-back">‹</div>
                    <div className="phone-wa-avatar">
                      <img src="/tori_logo_transparent.png" alt="תורי" />
                    </div>
                    <div className="phone-wa-info">
                      <div className="phone-wa-name">תורי — סלון דנה</div>
                      <div className="phone-wa-online">מחובר</div>
                    </div>
                  </div>
                  <div className="phone-chat">
                    <div className="chat-date">היום</div>
                    <div className="chat-bubble incoming" style={{ display: "none" }}>
                      שלום, רוצה לקבוע תספורת ביום חמישי
                      <div className="chat-time">21:03 <span className="chat-ticks">✓✓</span></div>
                    </div>
                    <div className="chat-typing" style={{ display: "none" }}>
                      <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
                    </div>
                    <div className="chat-bubble outgoing" style={{ display: "none" }}>
                      היי! 😊 ביום חמישי יש לי פנוי ב-9:30, 11:00 ו-14:30. מה מתאים?
                      <div className="chat-time">21:03</div>
                    </div>
                    <div className="chat-bubble incoming" style={{ display: "none" }}>
                      11:00 בסדר גמור
                      <div className="chat-time">21:04 <span className="chat-ticks">✓✓</span></div>
                    </div>
                    <div className="chat-typing" style={{ display: "none" }}>
                      <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
                    </div>
                    <div className="chat-bubble outgoing" style={{ display: "none" }}>
                      מעולה! קבעתי תספורת ביום חמישי ב-11:00 ✅
                      <div className="chat-time">21:04</div>
                    </div>
                    <div className="chat-bubble incoming" style={{ display: "none" }}>
                      תודה רבה! 🙏
                      <div className="chat-time">21:04 <span className="chat-ticks">✓✓</span></div>
                    </div>
                    <div className="chat-typing" style={{ display: "none" }}>
                      <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
                    </div>
                    <div className="chat-bubble outgoing" style={{ display: "none" }}>
                      בשמחה! אשלח תזכורת יום לפני. להתראות! 👋
                      <div className="chat-time">21:04</div>
                    </div>
                  </div>
                  <div className="phone-wa-input">
                    <div className="phone-wa-input-box">
                      <span className="phone-wa-input-icon">😊</span>
                      הודעה
                    </div>
                    <div className="phone-wa-send">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    </div>
                  </div>
                </div>
              </div>
              {/* Live notification toast — below phone */}
              <div id="hero-toast">
                <div className="ht-icon-wrap"><span className="ht-icon">📅</span></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ht-msg">תור חדש נקבע</div>
                  <div className="ht-sub">דנה כ. · ✂️ תספורת ב-11:00 מחר</div>
                </div>
                <div className="ht-live">
                  <div className="ht-dot" />
                  <span className="ht-live-label">חי</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* TRUST BAR */}
        <div className="lp-trust">
          <span className="lp-trust-label">עובד עם</span>
          <div className="lp-trust-items">
            {/* WhatsApp */}
            <div className="lp-trust-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect width="24" height="24" rx="6" fill="#25D366"/>
                <path d="M12 4a8 8 0 00-6.93 11.99L4 20l4.13-1.08A8 8 0 1012 4zm4.14 10.9c-.18.5-.88.96-1.47 1.08-.4.08-.92.14-2.68-.57-2.25-.9-3.7-3.17-3.81-3.32-.1-.14-.84-1.12-.84-2.14 0-1.01.53-1.51.72-1.72.18-.2.4-.25.53-.25h.38c.12 0 .28-.04.44.34l.62 1.5c.06.14.1.3.02.44l-.23.37-.3.35c-.1.1-.2.22-.09.43.12.2.53.87 1.14 1.41.78.7 1.45.91 1.65 1.01.2.1.31.08.43-.05l.49-.58c.12-.14.24-.1.4-.04l1.43.67c.2.1.34.14.39.23.05.1.05.55-.13 1.03z" fill="white"/>
              </svg>
              WhatsApp Business API
            </div>
            {/* Google */}
            <div className="lp-trust-item">
              <svg width="20" height="20" viewBox="0 0 24 24">
                <rect width="24" height="24" rx="6" fill="#fff" stroke="#E8E8E8"/>
                <path d="M21.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 22c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 19.53 7.7 22 12 22z" fill="#34A853"/>
                <path d="M5.84 13.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V6.07H2.18C1.43 7.55 1 9.22 1 11s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 4.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.09 14.97 0 12 0 7.7 0 3.99 2.47 2.18 6.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Google Calendar
            </div>
            {/* Claude / Anthropic */}
            <div className="lp-trust-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect width="24" height="24" rx="6" fill="#1B7FA0"/>
                <path d="M12 5l5 14H7L12 5z" fill="none" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M8.5 14h7" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Claude AI
            </div>
            {/* ElevenLabs */}
            <div className="lp-trust-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect width="24" height="24" rx="6" fill="#111"/>
                <path d="M8 7v10M12 4v16M16 7v10" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              ElevenLabs Voice
            </div>
            {/* Railway */}
            <div className="lp-trust-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect width="24" height="24" rx="6" fill="#0B0D0E"/>
                <path d="M5 18l3-12h3l-3 12H5zm6 0l3-12h3l-3 12h-3z" fill="white" opacity="0.9"/>
              </svg>
              Railway Cloud
            </div>
            {/* OpenAI */}
            <div className="lp-trust-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect width="24" height="24" rx="6" fill="#10A37F"/>
                <path d="M12 4.5a4.5 4.5 0 00-4.5 4.5v1H6a1.5 1.5 0 000 3h.5v3a4.5 4.5 0 009 0v-3H16a1.5 1.5 0 000-3h-1.5V9A4.5 4.5 0 0012 4.5zm0 2a2.5 2.5 0 012.5 2.5v1h-5V9A2.5 2.5 0 0112 6.5zm0 11a2.5 2.5 0 01-2.5-2.5v-3h5v3A2.5 2.5 0 0112 17.5z" fill="white"/>
              </svg>
              OpenAI
            </div>
            {/* Twilio */}
            <div className="lp-trust-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect width="24" height="24" rx="6" fill="#F22F46"/>
                <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="2" fill="none"/>
                <circle cx="10" cy="10" r="1.2" fill="white"/>
                <circle cx="14" cy="10" r="1.2" fill="white"/>
                <circle cx="10" cy="14" r="1.2" fill="white"/>
                <circle cx="14" cy="14" r="1.2" fill="white"/>
              </svg>
              Twilio SMS
            </div>
          </div>
        </div>

        {/* WAVE: white → dark */}
        <div className="wave" style={{ background: "#fff" }}>
          <svg viewBox="0 0 1440 64" preserveAspectRatio="none" style={{ height: 64 }}>
            <path d="M0,32 C360,64 1080,0 1440,32 L1440,64 L0,64 Z" fill="#0A0A0A"/>
          </svg>
        </div>

        {/* MARQUEE */}
        <div className="lp-marquee">
          <div className="marquee-track">
            {[
              { q: "\"חסכתי שעתיים ביום על ניהול תורים\"", name: "דנה כ., תל אביב" },
              { q: "\"הלקוחות מתפעלים שהבוט עונה ב-2 בלילה\"", name: "מיכל ל., ירושלים" },
              { q: "\"10 דקות הקמה, הגוגל קלנדר מתעדכן לבד\"", name: "יוסי ה., חיפה" },
              { q: "\"no-shows ירדו ב-80% מאז שהתחלנו\"", name: "שרה מ., רמת גן" },
              { q: "\"הבוט עונה יותר מהר ממני\"", name: "אמיר כ., באר שבע" },
              { q: "\"הכי טוב שעשיתי לסלון שלי\"", name: "רחל ב., נתניה" },
            ].concat([
              { q: "\"חסכתי שעתיים ביום על ניהול תורים\"", name: "דנה כ., תל אביב" },
              { q: "\"הלקוחות מתפעלים שהבוט עונה ב-2 בלילה\"", name: "מיכל ל., ירושלים" },
              { q: "\"10 דקות הקמה, הגוגל קלנדר מתעדכן לבד\"", name: "יוסי ה., חיפה" },
              { q: "\"no-shows ירדו ב-80% מאז שהתחלנו\"", name: "שרה מ., רמת גן" },
              { q: "\"הבוט עונה יותר מהר ממני\"", name: "אמיר כ., באר שבע" },
              { q: "\"הכי טוב שעשיתי לסלון שלי\"", name: "רחל ב., נתניה" },
            ]).map((m, i) => (
              <div key={i} className="marquee-item">
                <span className="star">★★★★★</span>
                <span>{m.q}</span>
                <strong>— {m.name}</strong>
              </div>
            ))}
          </div>
        </div>

        {/* STATS BAND */}
        <div className="lp-stats-band">
          <div className="lp-stats-band-inner">
            {[
              { n: 24, sup: "/7", l: "זמין גם כשאתה ישן — גם באמצע הלילה" },
              { n: 3,  sup: " דק׳", l: "זמן הקמה ממוצע עד שהבוט חי" },
              { n: 0,  sup: "₪", l: "עלות הכשרה לצוות — הכל אוטומטי" },
              { n: 100, sup: "%", l: "ממסרי הוואטסאפ נענים תוך שנייה" },
            ].map((s, i) => (
              <div key={i} className="lp-stat-cell reveal">
                <div className="lp-stat-n">
                  <span className="count-up" data-target={s.n}>0</span>
                  <span className="accent">{s.sup}</span>
                </div>
                <div className="lp-stat-l">{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* WAVE: dark → light */}
        <div className="wave" style={{ background: "#0A0A0A" }}>
          <svg viewBox="0 0 1440 64" preserveAspectRatio="none" style={{ height: 64 }}>
            <path d="M0,32 C360,0 1080,64 1440,32 L1440,64 L0,64 Z" fill="#F8F8F8"/>
          </svg>
        </div>

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
                  <div className="mock-sidebar-header">ניהול</div>
                  <div className="mock-nav-item active"><span className="mock-nav-dot" />תורים</div>
                  <div className="mock-nav-item"><span className="mock-nav-dot" />לקוחות</div>
                  <div className="mock-nav-item"><span className="mock-nav-dot" />שירותים</div>
                  <div className="mock-nav-item"><span className="mock-nav-dot" />אנליטיקה</div>
                  <div className="mock-nav-item" style={{ marginTop: "auto" }}><span className="mock-nav-dot" />הגדרות</div>
                </div>
                <div className="mock-main">
                  <div className="mock-main-header">
                    <div className="mock-main-title">סקירה · יולי 2025</div>
                    <div className="mock-main-badge">● פעיל</div>
                  </div>
                  <div className="mock-stats-row">
                    <div className="mock-stat">
                      <div className="mock-stat-l" style={{ marginBottom: 6 }}>תורים החודש</div>
                      <div className="mock-stat-n">47</div>
                      <div className="mock-stat-trend up">↑ 18% מחודש שעבר</div>
                    </div>
                    <div className="mock-stat">
                      <div className="mock-stat-l" style={{ marginBottom: 6 }}>הכנסה</div>
                      <div className="mock-stat-n"><span className="g">₪</span>8,240</div>
                      <div className="mock-stat-trend up">↑ ₪1,120</div>
                    </div>
                    <div className="mock-stat">
                      <div className="mock-stat-l" style={{ marginBottom: 6 }}>לקוחות חדשים</div>
                      <div className="mock-stat-n">23</div>
                      <div className="mock-stat-trend up">↑ 5 החודש</div>
                    </div>
                  </div>
                  <div className="mock-section-title">תורים קרובים</div>
                  <div className="mock-appt-list">
                    {[
                      { time: "09:30", name: "דנה כהן", svc: "תספורת", status: "confirmed", label: "מאושר" },
                      { time: "11:00", name: "מיכל לוי", svc: "צבע", status: "confirmed", label: "מאושר" },
                      { time: "14:30", name: "יוסי אברהם", svc: "תספורת + זקן", status: "pending", label: "ממתין" },
                      { time: "16:00", name: "שרה גולדברג", svc: "טיפול פנים", status: "confirmed", label: "מאושר" },
                    ].map((a) => (
                      <div key={a.time} className="mock-appt">
                        <span className="mock-appt-time">{a.time}</span>
                        <span className="mock-appt-name">{a.name}</span>
                        <span className="mock-appt-service">{a.svc}</span>
                        <span className={`mock-appt-badge ${a.status}`}>{a.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* INTEGRATION FLOW */}
        <section className="lp-flow" id="how">
          <div className="lp-flow-inner">
            <div className="lp-label reveal" style={{ textAlign: "center" }}>אינטגרציות</div>
            <div className="lp-title reveal" style={{ textAlign: "center" }}>הכל מחובר. אתה לא צריך לעשות כלום.</div>
            <div className="lp-flow-steps reveal">
              <div className="lp-flow-node">
                <div className="lp-flow-icon wa">
                  💬
                  <div className="lp-flow-ping green" />
                </div>
                <div className="lp-flow-label">WhatsApp</div>
                <div className="lp-flow-sub">לקוח שולח הודעה</div>
              </div>
              <div className="lp-flow-arrow">→</div>
              <div className="lp-flow-node">
                <div className="lp-flow-icon ai">
                  🤖
                  <div className="lp-flow-ping blue" />
                </div>
                <div className="lp-flow-label">תורי AI</div>
                <div className="lp-flow-sub">מבין, עונה, קובע</div>
              </div>
              <div className="lp-flow-arrow">→</div>
              <div className="lp-flow-node">
                <div className="lp-flow-icon cal">
                  📅
                  <div className="lp-flow-ping amber" />
                </div>
                <div className="lp-flow-label">Google Calendar</div>
                <div className="lp-flow-sub">מתעדכן אוטומטית</div>
              </div>
              <div className="lp-flow-arrow">→</div>
              <div className="lp-flow-node">
                <div className="lp-flow-icon phone">
                  📞
                  <div className="lp-flow-ping red" />
                </div>
                <div className="lp-flow-label">שיחות AI</div>
                <div className="lp-flow-sub">עונה גם לטלפון (פרמיום)</div>
              </div>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <div style={{ background: "#F8F8F8", borderTop: "1px solid #EBEBEB", borderBottom: "1px solid #EBEBEB", padding: "100px 40px" }}>
          <div style={{ maxWidth: 1080, margin: "0 auto" }}>
            <div className="lp-label reveal">תהליך</div>
            <div className="lp-title reveal">שלושה צעדים, ואחרי זה הכל קורה לבד.</div>
            <div className="lp-steps-grid">
              <div className="lp-step reveal d1">
                <div className="lp-step-num">01</div>
                <div className="lp-step-title">לקוח שולח הודעה ב-WhatsApp</div>
                <div className="lp-step-desc">הלקוח כותב כמו שהוא כותב — "רוצה תספורת ביום חמישי". הבוט מבין ועונה תוך שנייה, בעברית רגילה.</div>
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
          </div>
        </div>

        {/* FEATURES */}
        <section className="lp-features" id="features">
          <div className="lp-features-inner">
            <div className="lp-label reveal">מה כלול</div>
            <div className="lp-title reveal">כל הכלים שהעסק שלך צריך — ואפס כלים שלא.</div>
            <div className="lp-feats-grid">
              {[
                { icon: "💬", title: "בוט WhatsApp בעברית", desc: "מבין שפה טבעית, עונה ב-24/7, ומנהל שיחה מתחילה ועד אישור התור.", d: "d1" },
                { icon: "📅", title: "סנכרון גוגל קלנדר", desc: "חיבור חד-פעמי. כל תור שנקבע נכנס ליומן אוטומטית עם כל הפרטים.", d: "d2" },
                { icon: "🔔", title: "תזכורות אוטומטיות", desc: "הבוט שולח תזכורת ללקוח לפני כל תור. פחות no-shows, פחות שיחות.", d: "d3" },
                { icon: "📊", title: "דשבורד ניהול", desc: "הכנסות, תורים, לקוחות ושירותים פופולריים — הכל במסך אחד, בזמן אמת.", d: "d4" },
                { icon: "⏰", title: "שעות פתיחה גמישות", desc: "הגדר ימים ושעות לכל שירות וצוות. הבוט לא יציע זמנים שלא מתאימים.", d: "d5" },
                { icon: "📋", title: "רשימת המתנה", desc: "אין זמינות? הבוט מוסיף לרשימת המתנה ומיידע אותך כשמשהו מתפנה.", d: "d6" },
              ].map((f) => (
                <div key={f.title} className={`lp-feat reveal ${f.d}`}>
                  <div className="lp-feat-icon">{f.icon}</div>
                  <div className="lp-feat-title">{f.title}</div>
                  <div className="lp-feat-desc">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* WAVE: light gray → dark */}
        <div className="wave" style={{ background: "#F8F8F8" }}>
          <svg viewBox="0 0 1440 64" preserveAspectRatio="none" style={{ height: 64 }}>
            <path d="M0,32 C360,64 1080,0 1440,32 L1440,64 L0,64 Z" fill="#0A0A0A"/>
          </svg>
        </div>

        {/* BEFORE / AFTER */}
        <section className="lp-ba">
          <div className="lp-ba-inner">
            <div className="lp-label reveal">לפני ואחרי</div>
            <div className="lp-title reveal">מה השתנה לבעלי העסקים שעברו לתורי.</div>
            <div className="lp-ba-grid">
              <div className="lp-ba-card before reveal d1">
                <div className="lp-ba-header">
                  <div className="lp-ba-icon">😓</div>
                  <div className="lp-ba-tag">לפני תורי</div>
                </div>
                <div className="lp-ba-items">
                  {[
                    "לקוח שולח הודעה ואתה לא זמין — הוא כבר קבע אצל המתחרה",
                    "שעתיים ביום הולכות על תיאום תורים בטלפון ובוואטסאפ",
                    "no-shows שחוזרים כי אין מי שישלח תזכורות",
                    "גוגל קלנדר מתעדכן ידנית — או שוכחים ואז נוצרות התנגשויות",
                    "טלפון שמצלצל באמצע לקוח",
                  ].map((t) => (
                    <div key={t} className="lp-ba-item">
                      <span className="lp-ba-bullet">✕</span>
                      <span>{t}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="lp-ba-card after reveal d2">
                <div className="lp-ba-header">
                  <div className="lp-ba-icon">✨</div>
                  <div className="lp-ba-tag">עם תורי</div>
                </div>
                <div className="lp-ba-items">
                  {[
                    "הבוט עונה מיידית, 24/7 — גם כשאתה ישן בשעה 2 בלילה",
                    "תורים נקבעים אוטומטית ללא מגע יד אדם",
                    "תזכורות נשלחות אוטומטית לפני כל תור",
                    "גוגל קלנדר מתעדכן ברגע שתור נקבע",
                    "שיחות טלפון נענות על ידי AI — בתוכנית פרמיום",
                  ].map((t) => (
                    <div key={t} className="lp-ba-item">
                      <span className="lp-ba-bullet">✓</span>
                      <span>{t}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* WAVE: dark → white */}
        <div className="wave" style={{ background: "#0A0A0A" }}>
          <svg viewBox="0 0 1440 64" preserveAspectRatio="none" style={{ height: 64 }}>
            <path d="M0,32 C360,0 1080,64 1440,32 L1440,64 L0,64 Z" fill="#fff"/>
          </svg>
        </div>

        {/* TESTIMONIALS */}
        <section className="lp-testi">
          <div className="lp-testi-inner">
            <div className="lp-label reveal">מה אומרים לקוחותינו</div>
            <div className="lp-title reveal">בעלי עסקים שכבר עושים את זה עם תורי.</div>
            <div className="lp-testi-grid">
              {[
                { quote: "לפני תורי הייתי מפספסת הודעות כל הזמן. עכשיו הבוט עונה מיידית ואני מקבלת התראה רק על תורים שנקבעו. חסכתי שעתיים ביום.", name: "דנה כ.", role: "סלון שיער, תל אביב", color: "#2A9BBF", initial: "ד" },
                { quote: "הלקוחות שלי מתפעלים שהבוט עונה ב-2 בלילה. כמה מהם אמרו שזה גרם להם לבחור בי על פני סלון אחר.", name: "מיכל ל.", role: "קליניקת יופי, ירושלים", color: "#EC4899", initial: "מ" },
                { quote: "ניסיתי כמה מערכות לניהול תורים — זו הכי פשוטה להתקנה. 10 דקות ואני חי. הגוגל קלנדר מתעדכן לבד, זה שינה לי את החיים.", name: "יוסי ה.", role: "ברבר, חיפה", color: "#F59E0B", initial: "י" },
              ].map((t) => (
                <div key={t.name} className="lp-testi-card reveal">
                  <div className="lp-testi-stars">{[1,2,3,4,5].map((s) => <span key={s} className="lp-testi-star">★</span>)}</div>
                  <div className="lp-testi-quote">&ldquo;{t.quote}&rdquo;</div>
                  <div className="lp-testi-footer">
                    <div className="lp-testi-avatar" style={{ background: t.color }}>{t.initial}</div>
                    <div>
                      <div className="lp-testi-name">{t.name}</div>
                      <div className="lp-testi-role">{t.role}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* WAVE: white → dark */}
        <div className="wave" style={{ background: "#fff" }}>
          <svg viewBox="0 0 1440 64" preserveAspectRatio="none" style={{ height: 64 }}>
            <path d="M0,32 C480,64 960,0 1440,32 L1440,64 L0,64 Z" fill="#0A0A0A"/>
          </svg>
        </div>

        {/* PREMIUM VOICE */}
        <section className="lp-premium" id="premium">
          <div className="lp-premium-inner">
            <div className="reveal">
              <div className="lp-premium-badge">★ פרמיום</div>
              <div className="lp-premium-title">גם שיחות טלפון —<br /><span className="amber">הבוט עונה.</span></div>
              <div className="lp-premium-desc">לקוח מתקשר. סוכן AI עונה בקול טבעי, מנהל שיחה, קובע תור ומסנכרן לגוגל קלנדר — בלי שהרמת אצבע.</div>
              <div className="lp-premium-note">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                תכונה זו זמינה ב<strong>תוכנית פרמיום</strong> בתוספת תשלום חודשי
              </div>
              <a className="btn-amber" href="#pricing">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                ראה מחירים
              </a>
            </div>
            <div className="voice-card reveal d2">
              <div className="voice-card-header">
                <div className="voice-live-dot" />
                <div className="voice-card-title">שיחה נכנסת</div>
                <div className="voice-card-duration">00:42</div>
              </div>
              <div className="voice-waveform">
                {Array.from({ length: 15 }).map((_, i) => <div key={i} className="vbar" />)}
              </div>
              <div className="voice-transcript">
                <div className="vline caller-l"><div className="vspeaker caller">לקוח</div>שלום, רציתי לקבוע תספורת ליום חמישי בבוקר</div>
                <div className="vline ai-l"><div className="vspeaker ai">תורי AI</div>שלום! ביום חמישי יש לי פנוי ב-9:30 וב-11:00. מה מתאים?</div>
                <div className="vline caller-l"><div className="vspeaker caller">לקוח</div>9:30 מושלם</div>
                <div className="vline ai-l"><div className="vspeaker ai">תורי AI</div>בשמחה! קבעתי תספורת ביום חמישי ב-9:30. תקבל אישור בוואטסאפ.</div>
              </div>
            </div>
          </div>
        </section>

        {/* INTERACTIVE ROI CALCULATOR */}
        {/* LIVE INTERACTIVE DEMO */}
        <section className="lp-demo" id="demo">
          <div className="lp-demo-inner">
            <div className="lp-label reveal" style={{ textAlign: "center" }}>נסה בעצמך</div>
            <h2 className="lp-title reveal" style={{ textAlign: "center", marginBottom: 12 }}>דבר עם הבוט עכשיו</h2>
            <p className="reveal" style={{ textAlign: "center", color: "#666", fontSize: 16, marginBottom: 40 }}>
              כתוב הודעה כאילו אתה לקוח — ותראה איך תורי עונה. ללא התקנה, כאן ועכשיו.
            </p>
            <div className="lp-demo-chat reveal">
              <div className="lp-demo-header">
                <div className="lp-demo-avatar"><img src="/tori_logo_transparent.png" alt="תורי" /></div>
                <div>
                  <div className="lp-demo-name">תורי — סלון דנה</div>
                  <div className="lp-demo-status">מחובר · עונה תוך שנייה</div>
                </div>
              </div>
              <div className="lp-demo-body" ref={demoScrollRef}>
                {demoMsgs.map((m, i) => (
                  <div key={i} className={`lp-demo-bubble ${m.role}`}>{m.text}</div>
                ))}
              </div>
              <form className="lp-demo-input" onSubmit={sendDemo}>
                <input
                  value={demoInput}
                  onChange={(e) => setDemoInput(e.target.value)}
                  placeholder="כתוב הודעה..."
                  aria-label="הודעה לבוט"
                />
                <button type="submit" aria-label="שלח">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </button>
              </form>
            </div>
          </div>
        </section>

        <section className="lp-roi" id="roi">
          <div className="lp-roi-inner">
            <div className="lp-label reveal" style={{ textAlign: "center" }}>מחשבון חיסכון</div>
            <div className="lp-title reveal" style={{ color: "#fff", textAlign: "center" }}>כמה תורי חוסך לך?</div>
            <div className="lp-roi-sub reveal">גרור את הסליידר לפי מספר התורים השבועי שלך</div>

            <div className="lp-roi-slider-wrap reveal">
              <div className="roi-slider-label">
                <span>תורים בשבוע</span>
                <span className="roi-slider-val">{appts}</span>
              </div>
              <div style={{ direction: "ltr" }}>
                <input
                  type="range" min={5} max={150} step={5} value={appts}
                  className="roi-slider"
                  style={{ background: `linear-gradient(to right, #25D366 0%, #25D366 ${((appts - 5) / 145) * 100}%, rgba(255,255,255,0.15) ${((appts - 5) / 145) * 100}%, rgba(255,255,255,0.15) 100%)` }}
                  onChange={e => setAppts(Number(e.target.value))}
                />
              </div>
              <div style={{ direction: "ltr", display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 6 }}>
                <span>5</span><span>150</span>
              </div>
            </div>

            <div className="lp-roi-grid reveal">
              <div className="lp-roi-cell">
                <div className="lp-roi-n">
                  <span className="accent">{(Math.round(appts * 4 / 60 * 10) / 10).toFixed(1)}</span>
                  <span style={{ fontSize: 20, color: "#25D366", paddingBottom: 4 }}> שע׳</span>
                </div>
                <div className="lp-roi-l">שעות חסוכות בשבוע על תיאום ידני</div>
              </div>
              <div className="lp-roi-cell">
                <div className="lp-roi-n">
                  <span className="accent">{Math.round(appts * 0.15 * 0.8)}</span>
                  <span style={{ fontSize: 20, color: "#25D366", paddingBottom: 4 }}> ביטולים</span>
                </div>
                <div className="lp-roi-l">no-shows פחות בחודש עם תזכורות אוטומטיות</div>
              </div>
              <div className="lp-roi-cell">
                <div className="lp-roi-n">
                  <span className="amber">₪</span>
                  <span style={{ color: "#fff" }}>{(Math.round(appts * 0.15 * 0.8) * 180).toLocaleString("he-IL")}</span>
                </div>
                <div className="lp-roi-l">הכנסה נוספת ממוצעת בחודש מתורים שנשמרו</div>
              </div>
              <div className="lp-roi-cell" style={{ position: "relative", overflow: "hidden", border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.06)" }}>
                <div style={{ position: "absolute", top: 8, left: 10, background: "rgba(245,158,11,0.2)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 6, padding: "2px 7px", fontSize: 9, color: "#F59E0B", fontWeight: 700, letterSpacing: "0.06em" }}>פרמיום</div>
                <div className="lp-roi-n">
                  <span style={{ color: "#F59E0B" }}>₪</span>
                  <span style={{ color: "#fff" }}>{(Math.round(appts * 0.15 * 0.8) * 180 + Math.round(appts * 5 / 60 * 4.3 * 38)).toLocaleString("he-IL")}</span>
                </div>
                <div className="lp-roi-l">סה"כ חיסכון + הכנסה בפרמיום (כולל עובד טלפון)</div>
              </div>
            </div>
            <div className="lp-roi-note reveal">
              המחיר: <strong>₪149/חודש</strong> · ROI: כ-<strong>
                {appts > 10 ? `${Math.round((Math.round(appts * 0.15 * 0.8) * 180) / 149)}x` : "1x"}
              </strong> תוך החודש הראשון.
            </div>
          </div>
        </section>

        {/* WAVE: dark → white */}
        <div className="wave" style={{ background: "#0A0A0A" }}>
          <svg viewBox="0 0 1440 64" preserveAspectRatio="none" style={{ height: 64 }}>
            <path d="M0,32 C480,0 960,64 1440,32 L1440,64 L0,64 Z" fill="#fff"/>
          </svg>
        </div>

        {/* PRICING */}
        <section className="lp-pricing" id="pricing">
          <div className="lp-pricing-inner">
            <div className="lp-label reveal" style={{ textAlign: "center" }}>מחירים</div>
            <div className="lp-title reveal" style={{ textAlign: "center" }}>פשוט. שקוף. ללא הפתעות.</div>
            <div className="lp-pricing-grid">
              <div className="lp-plan reveal d1">
                <div className="lp-plan-tag">סטנדרט</div>
                <div className="lp-plan-name">Standard</div>
                <div className="lp-plan-price">₪149</div>
                <div className="lp-plan-per">לחודש · ניסיון 14 יום חינם</div>
                <div className="lp-plan-divider" />
                <div className="lp-plan-features">
                  {["בוט WhatsApp בעברית, 24/7","סנכרון גוגל קלנדר אוטומטי","תזכורות אוטומטיות ללקוחות","דשבורד ניהול מלא","שירותים, צוות ושעות גמישות","רשימת המתנה","תמיכה בדוא\"ל"].map((f) => (
                    <div key={f} className="lp-plan-feat"><span className="check">✓</span>{f}</div>
                  ))}
                </div>
                <a className="lp-plan-btn dark" href="/login">התחל ניסיון חינם</a>
              </div>
              <div className="lp-plan featured reveal d2">
                <div className="lp-plan-tag">פרמיום</div>
                <div className="lp-plan-name">Premium</div>
                <div className="lp-plan-price">₪299</div>
                <div className="lp-plan-per">לחודש · ללא חוזה</div>
                <div className="lp-plan-divider" />
                <div className="lp-plan-features">
                  {["הכל שב-Standard","מענה לשיחות טלפון נכנסות","קול AI טבעי (ElevenLabs)","תמלול שיחות אוטומטי","סנכרון תורים משיחות לגוגל קלנדר","תמיכה מועדפת בוואטסאפ","SLA של 4 שעות"].map((f) => (
                    <div key={f} className="lp-plan-feat"><span className="check">✓</span>{f}</div>
                  ))}
                </div>
                <a className="lp-plan-btn amber" href="/login">התחל ניסיון חינם</a>
              </div>
            </div>
          </div>
        </section>

        {/* WAVE: white → light gray */}
        <div className="wave" style={{ background: "#fff" }}>
          <svg viewBox="0 0 1440 64" preserveAspectRatio="none" style={{ height: 64 }}>
            <path d="M0,32 C360,64 1080,0 1440,32 L1440,64 L0,64 Z" fill="#F8F8F8"/>
          </svg>
        </div>

        {/* FAQ */}
        <section className="lp-faq" id="faq">
          <div className="lp-faq-inner">
            <div className="lp-label reveal" style={{ textAlign: "center" }}>שאלות נפוצות</div>
            <div className="lp-title reveal" style={{ textAlign: "center" }}>שאלות? יש לנו תשובות.</div>
            <div className="lp-faq-list reveal">
              {[
                { q: "האם הבוט מבין עברית טבעית?", a: "כן. הבוט מבוסס על Claude AI של Anthropic ומבין עברית טבעית לחלוטין — כולל ניבים, קיצורים ואיות לא מדויק. לא צריך ללמד את הלקוחות להקליד בצורה מיוחדת." },
                { q: "כמה זמן לוקחת ההקמה?", a: "בממוצע 3–10 דקות. מתחברים לוואטסאפ Business, מוסיפים את השירותים ושעות הפתיחה, מחברים גוגל קלנדר — והבוט חי." },
                { q: "האם הלקוחות יודעים שזה בוט?", a: "זה תלוי בך. ניתן להגדיר את הבוט כ-'עוזר חכם' של הסלון ולהגדיר את האישיות שלו. רוב הלקוחות לא מבחינים — אבל אפשר גם לציין את זה." },
                { q: "מה קורה אם לקוח רוצה שירות שאין ברשימה?", a: "הבוט יגיד ללקוח שהשירות הזה אינו זמין להזמנה אוטומטית ויציע ליצור קשר ישיר. ניתן גם להוסיף תשובות FAQ מותאמות אישית לשאלות נפוצות." },
                { q: "האם צריך להתקין אפליקציה כלשהי?", a: "לא. הכל עובד דרך הדפדפן — הדשבורד נגיש מכל מכשיר. הלקוחות שולחים הודעות דרך WhatsApp הרגיל שלהם." },
                { q: "האם ניתן לבטל בכל עת?", a: "כן. אין חוזים ואין דמי ביטול. מבטלים בלחיצה אחת מהדשבורד." },
              ].map((item) => (
                <div key={item.q} className="faq-item">
                  <div className="faq-q">
                    <span>{item.q}</span>
                    <span className="faq-icon">+</span>
                  </div>
                  <div className="faq-a">
                    <div className="faq-a-inner">{item.a}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* WAVE: light gray → white */}
        <div className="wave" style={{ background: "#F8F8F8" }}>
          <svg viewBox="0 0 1440 64" preserveAspectRatio="none" style={{ height: 64 }}>
            <path d="M0,32 C360,0 1080,64 1440,32 L1440,64 L0,64 Z" fill="#fff"/>
          </svg>
        </div>

        {/* CTA */}
        <section className="lp-cta reveal">
          <div className="lp-cta-title">תפסיק לענות לכולם בעצמך.</div>
          <div className="lp-cta-sub">נסה 14 יום בחינם — ללא כרטיס אשראי, ללא סיכון.</div>
          <div className="lp-cta-row">
            <a className="btn-green" href="/login">התחל עכשיו בחינם</a>
            <a className="btn-outline" href="#pricing">ראה מחירים</a>
          </div>
          <div className="lp-cta-trust">
            <span className="lp-cta-trust-item">✓ אין צורך בכרטיס אשראי</span>
            <span className="lp-cta-trust-item">✓ ביטול בכל עת</span>
            <span className="lp-cta-trust-item">✓ הקמה תוך 10 דקות</span>
            <span className="lp-cta-trust-item">✓ תמיכה בוואטסאפ</span>
          </div>
        </section>

        {/* WAVE: white → dark footer */}
        <div className="wave" style={{ background: "#fff" }}>
          <svg viewBox="0 0 1440 64" preserveAspectRatio="none" style={{ height: 64 }}>
            <path d="M0,32 C480,64 960,0 1440,32 L1440,64 L0,64 Z" fill="#0A0A0A"/>
          </svg>
        </div>

        {/* FOOTER */}
        <footer className="lp-footer">
          <div className="lp-footer-top">
            <div className="lp-footer-brand-block">
              <div className="lp-footer-logo-row">
                <img src="/tori_logo_transparent.png" alt="תורי" loading="lazy" />
                <span className="lp-footer-brand">תורי</span>
              </div>
              <div className="lp-footer-tagline">בוט WhatsApp AI שקובע תורים אוטומטית לסלונים ועסקים קטנים — 24/7, ללא מגע יד אדם.</div>
            </div>
            <div className="lp-footer-col">
              <h4>מוצר</h4>
              <a href="#how">איך זה עובד</a>
              <a href="#features">תכונות</a>
              <a href="#premium">פרמיום</a>
              <a href="#pricing">מחירים</a>
              <a href="#roi">מחשבון חיסכון</a>
            </div>
            <div className="lp-footer-col">
              <h4>עזרה</h4>
              <a href="#faq">שאלות נפוצות</a>
              <a href="/login">כניסה לדשבורד</a>
              <a href="/privacy">מדיניות פרטיות</a>
              <a href="/en">English</a>
            </div>
            <div className="lp-footer-col">
              <h4>מתאים ל</h4>
              <div className="lp-footer-suitable">
                <a href="#">סלוני שיער</a>
                <a href="#">מספרות</a>
                <a href="#">ציפורניים</a>
                <a href="#">קוסמטיקה</a>
                <a href="#">עיסוי וספא</a>
                <a href="#">קליניקות</a>
                <a href="#">מרפאות שיניים</a>
                <a href="#">סטודיו כושר</a>
                <a href="#">צימרים</a>
                <a href="#">וטרינרים</a>
              </div>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span className="lp-footer-copy">© 2026 torionline.com · כל הזכויות שמורות · <a href="/privacy" className="lp-footer-copy-link">מדיניות פרטיות</a></span>
            <span className="lp-footer-copy">עשוי באהבה לבעלי עסקים קטנים 🇮🇱</span>
          </div>
        </footer>

      </div>
    </>
  );
}
