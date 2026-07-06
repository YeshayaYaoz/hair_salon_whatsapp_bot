"use client";

import { useEffect, useRef, useState } from "react";

export default function LandingPageEN() {
  const tiltEl = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [appts, setAppts] = useState(40);

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

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) (e.target as HTMLElement).classList.add("in"); }),
      { threshold: 0.08 }
    );
    document.querySelectorAll(".reveal").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

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

  useEffect(() => {
    const toasts = [
      { icon: "📅", msg: "New appointment booked", sub: "Dana K. · ✂️ Haircut at 11:00 tomorrow" },
      { icon: "🔔", msg: "Reminder sent automatically", sub: "Michelle L. · Facial at 14:30" },
      { icon: "⚡", msg: "Bot replied in 0.8 seconds", sub: "New customer on WhatsApp" },
      { icon: "✅", msg: "Cancellation handled automatically", sub: "Joe H. · Slot now open in calendar" },
      { icon: "📅", msg: "New appointment booked", sub: "Sarah M. · 💅 Nails at 16:00" },
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

      // DOM order: [incoming, typing, outgoing, incoming, typing, outgoing, incoming]
      items.forEach((el) => { el.style.display = "none"; el.classList.remove("show"); });
      if (container) container.scrollTop = 0;
      if (header) { header.textContent = "online"; header.classList.remove("is-typing"); }

      const scrollDown = () => { if (container) container.scrollTop = container.scrollHeight; };
      const showEl = (el: HTMLElement) => {
        el.style.display = el.classList.contains("chat-typing") ? "flex" : "";
        requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add("show"); scrollDown(); }));
      };
      const hideEl = (el: HTMLElement) => {
        el.classList.remove("show");
        timers.push(setTimeout(() => { el.style.display = "none"; }, 240));
      };
      const setTyping = (on: boolean) => {
        if (!header) return;
        header.textContent = on ? "typing" : "online";
        header.classList.toggle("is-typing", on);
      };

      const actions: { at: number; fn: () => void }[] = [];
      let t = 500;
      const triples = [[0, 1, 2], [3, 4, 5]];
      for (const [inc, typ, out] of triples) {
        actions.push({ at: t, fn: () => showEl(items[inc]) }); t += 1300;
        actions.push({ at: t, fn: () => { setTyping(true); showEl(items[typ]); } }); t += 1250;
        actions.push({ at: t, fn: () => { setTyping(false); hideEl(items[typ]); showEl(items[out]); } }); t += 1500;
      }
      // Trailing incoming "thanks" message
      actions.push({ at: t, fn: () => showEl(items[6]) }); t += 1200;

      for (const a of actions) timers.push(setTimeout(a.fn, a.at));
      timers.push(setTimeout(runSequence, t + 2600));
    }

    runSequence();
    return () => timers.forEach(clearTimeout);
  }, []);

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

  const savingsHours = Math.round(appts * 5 / 60 * 4.3);
  const extraIncome = Math.round(appts * 0.15 * 0.8) * 180;
  const staffSavings = Math.round(appts * 5 / 60 * 4.3 * 38);
  const premiumTotal = extraIncome + staffSavings;

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .lp {
          background: #fff; color: #111;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
          direction: ltr; -webkit-font-smoothing: antialiased; overflow-x: hidden;
        }
        #scroll-bar { position: fixed; top: 0; left: 0; height: 2px; background: #25D366; z-index: 9999; width: 0; transition: width 0.05s linear; }

        #sticky-cta {
          position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
          z-index: 500; opacity: 0; transition: opacity 0.3s ease;
          background: #25D366; color: #fff; font-size: 14px; font-weight: 700;
          padding: 13px 28px; border-radius: 40px; text-decoration: none;
          box-shadow: 0 8px 28px rgba(37,211,102,0.45);
          display: flex; align-items: center; gap: 8px; white-space: nowrap;
        }
        #sticky-cta:hover { opacity: 0.88 !important; transform: translateX(-50%) translateY(-2px); }

        .lp-nav {
          position: fixed; top: 0; left: 0; right: 0; z-index: 200; height: 62px;
          background: rgba(255,255,255,0.92); backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(0,0,0,0.07);
          display: flex; align-items: center; justify-content: space-between; padding: 0 44px;
        }
        .lp-nav-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
        .lp-nav-logo span { font-size: 16px; font-weight: 700; color: #111; letter-spacing: -0.3px; }
        .lp-nav-links { display: flex; align-items: center; gap: 4px; }
        .lp-nav-link { font-size: 13px; font-weight: 500; color: #555; text-decoration: none; padding: 7px 14px; border-radius: 7px; transition: background 0.15s, color 0.15s; }
        .lp-nav-link:hover { background: #F5F5F5; color: #111; }
        .lp-nav-cta { font-size: 13px; font-weight: 600; color: #fff; background: #111; text-decoration: none; padding: 8px 18px; border-radius: 8px; transition: opacity 0.15s, transform 0.15s; }
        .lp-nav-cta:hover { opacity: 0.8; transform: translateY(-1px); }

        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:none; } }
        @keyframes fadeDown { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:none; } }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }

        .lp-hero {
          min-height: 100vh; padding-top: 62px;
          display: grid; grid-template-columns: 1fr 1fr;
          align-items: center; gap: 48px;
          padding-left: 60px; padding-right: 60px;
          background: #fff; max-width: 1200px; margin: 0 auto;
        }
        .lp-hero-text { padding: 60px 0; }
        .lp-kicker { display: inline-flex; align-items: center; gap: 7px; background: #F0FFF4; border: 1px solid #BBF7D0; color: #15803D; font-size: 12px; font-weight: 600; padding: 5px 14px; border-radius: 20px; margin-bottom: 28px; animation: fadeUp 0.6s ease 0.2s both; }
        .lp-kicker-dot { width: 6px; height: 6px; border-radius: 50%; background: #25D366; animation: pulse-green 2s infinite; }
        @keyframes pulse-green { 0%,100% { box-shadow: 0 0 0 0 rgba(37,211,102,0.4); } 50% { box-shadow: 0 0 0 5px rgba(37,211,102,0); } }
        .lp-h1 { font-size: clamp(36px, 5vw, 60px); font-weight: 900; letter-spacing: -2.5px; line-height: 1.08; margin-bottom: 20px; animation: fadeUp 0.6s ease 0.25s both; color: #0A0A0A; text-wrap: balance; }
        .lp-h1 .green { color: #25D366; }
        .lp-sub { font-size: 17px; color: #555; line-height: 1.65; margin-bottom: 36px; animation: fadeUp 0.6s ease 0.3s both; max-width: 480px; }
        .lp-hero-btns { display: flex; gap: 12px; flex-wrap: wrap; animation: fadeUp 0.6s ease 0.35s both; }
        .btn-green { display: inline-flex; align-items: center; gap: 8px; background: #25D366; color: #fff; font-size: 15px; font-weight: 700; padding: 14px 28px; border-radius: 12px; text-decoration: none; box-shadow: 0 4px 20px rgba(37,211,102,0.35); transition: transform 0.15s, box-shadow 0.15s; }
        .btn-green:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(37,211,102,0.45); }
        .btn-outline { display: inline-flex; align-items: center; gap: 8px; border: 1.5px solid #DDD; color: #444; font-size: 15px; font-weight: 600; padding: 14px 28px; border-radius: 12px; text-decoration: none; transition: border-color 0.15s, color 0.15s; background: #fff; }
        .btn-outline:hover { border-color: #999; color: #111; }

        .lp-hero-trust { display: flex; align-items: center; gap: 20px; margin-top: 28px; animation: fadeUp 0.6s ease 0.4s both; flex-wrap: wrap; }
        .lp-trust-item-sm { font-size: 12px; color: #888; display: flex; align-items: center; gap: 5px; }
        .lp-trust-dot-g { width: 6px; height: 6px; border-radius: 50%; background: #25D366; }

        /* Phone mock */
        .lp-hero-phone { position: relative; z-index: 1; animation: fadeUp 0.7s ease 0.3s both; }
        .lp-hero-phone::before {
          content: ''; position: absolute; width: 340px; height: 340px; border-radius: 50%;
          background: radial-gradient(circle, rgba(37,211,102,0.16) 0%, rgba(37,211,102,0) 68%);
          top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: -1;
          animation: glowPulse 5s ease-in-out infinite;
        }
        @keyframes glowPulse { 0%, 100% { opacity: 0.6; transform: translate(-50%,-50%) scale(0.92); } 50% { opacity: 1; transform: translate(-50%,-50%) scale(1.06); } }
        .phone-wrap { filter: drop-shadow(0 32px 64px rgba(0,0,0,0.28)) drop-shadow(0 0 1px rgba(0,0,0,0.4)); }
        .phone-frame { background: #1C1C1E; border-radius: 44px; border: 8px solid #1C1C1E; max-width: 290px; margin: 0 auto; position: relative; overflow: hidden; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12); }
        .phone-frame::before { content: ''; position: absolute; left: -12px; top: 80px; width: 4px; height: 32px; background: #2A2A2C; border-radius: 2px 0 0 2px; }
        .phone-frame::after { content: ''; position: absolute; right: -12px; top: 100px; width: 4px; height: 48px; background: #2A2A2C; border-radius: 0 2px 2px 0; }
        .phone-island { width: 100px; height: 28px; background: #000; border-radius: 0 0 18px 18px; margin: 0 auto; position: relative; z-index: 2; display: flex; align-items: center; justify-content: center; gap: 6px; }
        .phone-island-cam { width: 9px; height: 9px; border-radius: 50%; background: #1A1A1A; border: 1px solid #222; }
        .phone-island-cam-inner { width: 4px; height: 4px; border-radius: 50%; background: #0A0A0A; margin: auto; }
        .phone-status-bar { display: flex; align-items: center; justify-content: space-between; padding: 2px 18px 6px; background: #fff; }
        .phone-status-time { font-size: 11px; font-weight: 700; color: #111; letter-spacing: -0.3px; }
        .phone-status-icons { display: flex; align-items: center; gap: 5px; }
        .phone-status-icons svg { display: block; }
        .phone-status-icon { font-size: 10px; color: #111; font-weight: 600; }
        .phone-wa-avatar { width: 34px; height: 34px; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; box-shadow: 0 0 0 2px rgba(37,211,102,0.2); }
        .phone-wa-avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
        .phone-wa-info { flex: 1; }
        .phone-wa-name { font-size: 12.5px; font-weight: 700; color: #111; }
        .phone-wa-online { font-size: 10px; color: #128C7E; font-weight: 500; }
        .phone-wa-actions { display: flex; gap: 12px; margin-left: auto; }
        .phone-wa-bar { background: #fff; padding: 10px 14px; display: flex; align-items: center; gap: 9px; border-bottom: 1px solid #F0F0F0; }
        .phone-wa-back { color: #128C7E; font-size: 18px; font-weight: 300; line-height: 1; flex-shrink: 0; }
        .phone-chat { background-color: #E5DDD5; padding: 12px 10px; display: flex; flex-direction: column; gap: 6px; height: 330px; overflow-y: auto; scroll-behavior: smooth; scrollbar-width: none; }
        .phone-chat::-webkit-scrollbar { display: none; }
        .chat-date { align-self: center; font-size: 10px; background: rgba(255,255,255,0.75); color: #666; border-radius: 6px; padding: 2px 8px; margin: 2px 0 4px; font-weight: 500; }
        .chat-bubble { max-width: 82%; padding: 7px 10px 4px; border-radius: 8px; font-size: 12.5px; line-height: 1.45; opacity: 0; transform: translateY(8px) scale(0.9); transition: opacity 0.3s ease, transform 0.34s cubic-bezier(0.22, 1, 0.36, 1); position: relative; }
        .chat-bubble.incoming { transform-origin: top right; }
        .chat-bubble.outgoing { transform-origin: top left; }
        .chat-bubble.show { opacity: 1; transform: none; }
        .phone-wa-online.is-typing { color: #25D366; }
        .phone-wa-online.is-typing::after { content: ''; display: inline-block; width: 3px; height: 3px; border-radius: 50%; background: currentColor; margin-inline-start: 3px; animation: typingDotHeader 1s steps(3) infinite; box-shadow: 5px 0 0 currentColor, 10px 0 0 currentColor; }
        @keyframes typingDotHeader { 0% { opacity: 0.2; } 50% { opacity: 1; } 100% { opacity: 0.2; } }
        /* Customer's own messages — green, right side */
        .chat-bubble.incoming { background: #D9FDD3; border-radius: 8px 8px 0 8px; align-self: flex-end; color: #111; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
        /* Bot (salon) messages — white, left side */
        .chat-bubble.outgoing { background: #fff; border-radius: 0 8px 8px 8px; align-self: flex-start; color: #111; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
        .chat-bubble.incoming::before { content: ''; position: absolute; top: 0; right: -7px; width: 0; height: 0; border-top: 0px solid transparent; border-left: 8px solid #D9FDD3; border-bottom: 8px solid transparent; }
        .chat-bubble.outgoing::before { content: ''; position: absolute; top: 0; left: -7px; width: 0; height: 0; border-top: 0px solid transparent; border-right: 8px solid #fff; border-bottom: 8px solid transparent; }
        .chat-time { font-size: 9.5px; color: #999; margin-top: 2px; text-align: right; display: flex; align-items: center; justify-content: flex-end; gap: 3px; }
        .chat-ticks { color: #53BDEB; font-size: 9px; }
        .chat-typing { align-self: flex-start; background: #fff; padding: 9px 12px; border-radius: 0 8px 8px 8px; display: flex; gap: 4px; align-items: center; opacity: 0; transform: translateY(6px); transition: opacity 0.3s ease, transform 0.3s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
        .chat-typing.show { opacity: 1; transform: none; }
        .typing-dot { width: 7px; height: 7px; border-radius: 50%; background: #C0C0C0; animation: typing 1.4s infinite ease-in-out; }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typing { 0%,60%,100% { transform: translateY(0); opacity: 0.6; } 30% { transform: translateY(-5px); opacity: 1; } }
        .phone-wa-input { background: #F0F0F0; padding: 7px 10px; display: flex; align-items: center; gap: 7px; }
        .phone-wa-input-box { flex: 1; background: #fff; border-radius: 22px; padding: 7px 12px; font-size: 11px; color: #999; display: flex; align-items: center; gap: 6px; }
        .phone-wa-input-icon { color: #999; font-size: 13px; }
        .phone-wa-send { width: 34px; height: 34px; border-radius: 50%; background: #128C7E; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 6px rgba(18,140,126,0.35); }

        /* Toast */
        #hero-toast {
          position: absolute; bottom: 40px; right: 40px; z-index: 20;
          background: #fff; border-radius: 14px; padding: 12px 16px;
          display: flex; align-items: center; gap: 10px; min-width: 240px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.05);
          opacity: 0; transform: translateY(12px);
          transition: opacity 0.35s ease, transform 0.35s ease;
        }
        #hero-toast.ht-in { opacity: 1; transform: none; }
        #hero-toast.ht-out { opacity: 0; transform: translateY(-8px); }
        .ht-icon-wrap { width: 36px; height: 36px; border-radius: 10px; background: #F0FFF4; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
        .ht-msg { font-size: 12.5px; font-weight: 600; color: #111; }
        .ht-sub { font-size: 11px; color: #888; margin-top: 2px; }
        .ht-live { display: flex; align-items: center; gap: 4px; margin-left: auto; }
        .ht-dot { width: 6px; height: 6px; border-radius: 50%; background: #25D366; animation: pulse-green 2s infinite; }
        .ht-live-label { font-size: 10px; font-weight: 700; color: #25D366; }

        /* Trust bar */
        .lp-trust-bar { padding: 28px 40px; border-top: 1px solid #EBEBEB; border-bottom: 1px solid #EBEBEB; }
        .lp-trust-bar-inner { max-width: 1080px; margin: 0 auto; display: flex; align-items: center; gap: 32px; flex-wrap: wrap; justify-content: center; }
        .lp-trust-label { font-size: 11px; font-weight: 700; color: #BBB; letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; }
        .lp-trust-logo { display: flex; align-items: center; gap: 8px; opacity: 0.45; filter: grayscale(1); transition: opacity 0.2s, filter 0.2s; }
        .lp-trust-logo:hover { opacity: 0.7; filter: grayscale(0); }
        .lp-trust-logo-text { font-size: 15px; font-weight: 800; color: #111; letter-spacing: -0.5px; }

        /* Stats band */
        .lp-stats-band { background: #0A0A0A; padding: 72px 40px; }
        .lp-stats-band-inner { max-width: 1080px; margin: 0 auto; display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
        .lp-stat-cell { padding: 48px 36px; background: #141414; border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; }
        .lp-stat-n { font-size: 52px; font-weight: 800; letter-spacing: -3px; line-height: 1; color: #fff; margin-bottom: 6px; font-variant-numeric: tabular-nums; display: flex; align-items: flex-end; gap: 2px; }
        .lp-stat-n .accent { color: #F59E0B; font-size: 32px; padding-bottom: 6px; }
        .lp-stat-n .count-up { display: inline-block; }
        .lp-stat-l { font-size: 14px; color: rgba(255,255,255,0.72); line-height: 1.5; }
        @media (max-width: 768px) { .lp-stats-band-inner { grid-template-columns: repeat(2,1fr); } }

        /* Sections */
        .lp-section { padding: 100px 40px; }
        .lp-section-inner { max-width: 1080px; margin: 0 auto; }
        .lp-label { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #25D366; margin-bottom: 12px; }
        .lp-title { font-size: clamp(26px, 4vw, 42px); font-weight: 900; letter-spacing: -1.5px; line-height: 1.15; color: #0A0A0A; margin-bottom: 48px; text-wrap: balance; }
        .reveal { opacity: 0; transform: translateY(18px); transition: opacity 0.55s ease, transform 0.55s ease; }
        .reveal.in { opacity: 1; transform: none; }

        /* Flow */
        .lp-flow { padding: 100px 40px; background: #F9FAFB; }
        .lp-flow-inner { max-width: 1080px; margin: 0 auto; }
        .lp-flow-steps { display: flex; align-items: center; justify-content: center; gap: 0; flex-wrap: wrap; margin-top: 16px; }
        .lp-flow-node { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 24px 20px; }
        .lp-flow-icon { width: 64px; height: 64px; border-radius: 18px; background: #fff; border: 1px solid #E5E7EB; display: flex; align-items: center; justify-content: center; font-size: 26px; position: relative; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
        .lp-flow-icon.wa { background: #F0FFF4; border-color: #BBF7D0; }
        .lp-flow-icon.ai { background: #EFF6FF; border-color: #BFDBFE; }
        .lp-flow-icon.cal { background: #FFF7ED; border-color: #FED7AA; }
        .lp-flow-icon.voice { background: #FDF4FF; border-color: #E9D5FF; }
        .lp-flow-ping { position: absolute; top: -4px; right: -4px; width: 10px; height: 10px; border-radius: 50%; animation: ping 1.5s infinite; }
        .lp-flow-ping.green { background: #25D366; box-shadow: 0 0 0 3px rgba(37,211,102,0.2); }
        .lp-flow-ping.blue { background: #3B82F6; box-shadow: 0 0 0 3px rgba(59,130,246,0.2); }
        @keyframes ping { 0%,100% { transform: scale(1); opacity:1; } 60% { transform: scale(1.5); opacity:0.3; } }
        .lp-flow-label { font-size: 13px; font-weight: 700; color: #111; }
        .lp-flow-sub { font-size: 11px; color: #888; text-align: center; }
        .lp-flow-arrow { font-size: 20px; color: #DDD; padding: 0 4px; }

        /* Steps */
        .lp-steps { padding: 100px 40px; }
        .lp-steps-inner { max-width: 1080px; margin: 0 auto; }
        .lp-steps-list { display: flex; flex-direction: column; gap: 32px; }
        .lp-step { display: grid; grid-template-columns: 52px 1fr; gap: 24px; align-items: start; }
        .lp-step-num { width: 52px; height: 52px; border-radius: 14px; background: #F5F5F5; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900; color: #111; flex-shrink: 0; }
        .lp-step-title { font-size: 17px; font-weight: 700; color: #111; margin-bottom: 6px; }
        .lp-step-desc { font-size: 15.5px; color: #666; line-height: 1.65; }

        /* Features */
        .lp-features { padding: 100px 40px; background: #F9FAFB; }
        .lp-features-inner { max-width: 1080px; margin: 0 auto; }
        .lp-feats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        @media (max-width: 900px) { .lp-feats-grid { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 600px) { .lp-feats-grid { grid-template-columns: 1fr; } }
        .lp-feat { background: #fff; border: 1px solid #EBEBEB; border-radius: 16px; padding: 28px; transition: box-shadow 0.2s, border-color 0.2s; }
        .lp-feat:hover { box-shadow: 0 8px 32px rgba(0,0,0,0.08); border-color: #DDD; }
        .lp-feat-icon { font-size: 26px; margin-bottom: 14px; }
        .lp-feat-title { font-size: 15px; font-weight: 700; color: #111; margin-bottom: 8px; }
        .feat-desc { font-size: 13.5px; color: #666; line-height: 1.6; }

        /* Before/After */
        .lp-ba { background: #0A0A0A; border-top: 1px solid rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.06); padding: 100px 40px; }
        .lp-ba-inner { max-width: 1080px; margin: 0 auto; }
        .lp-ba-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
        @media (max-width: 700px) { .lp-ba-grid { grid-template-columns: 1fr; } }
        .lp-ba-card { border-radius: 20px; padding: 36px 32px; border: 1px solid transparent; }
        .lp-ba-card.before { background: rgba(239,68,68,0.06); border-color: rgba(239,68,68,0.2); }
        .lp-ba-card.after { background: rgba(37,211,102,0.06); border-color: rgba(37,211,102,0.25); }
        .lp-ba-tag { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 20px; }
        .before .lp-ba-tag { color: #F87171; }
        .after .lp-ba-tag { color: #25D366; }
        .lp-ba-items { display: flex; flex-direction: column; gap: 12px; }
        .lp-ba-item { font-size: 15px; line-height: 1.6; color: rgba(255,255,255,0.75); display: flex; align-items: flex-start; gap: 10px; }
        .lp-ba-item-dot { width: 5px; height: 5px; border-radius: 50%; margin-top: 8px; flex-shrink: 0; }
        .before .lp-ba-item-dot { background: #F87171; }
        .after .lp-ba-item-dot { background: #25D366; }

        /* Testimonials */
        .lp-testimonials { padding: 100px 40px; background: #fff; overflow: hidden; }
        .lp-testimonials-inner { max-width: 1080px; margin: 0 auto; }
        .lp-testi-track-wrap { overflow: hidden; margin-top: 16px; -webkit-mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent); mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent); }
        .lp-testi-track { display: flex; gap: 16px; animation: scrollLeft 32s linear infinite; width: max-content; }
        @keyframes scrollLeft { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .lp-testi-track:hover { animation-play-state: paused; }
        .lp-testi-card { background: #F9FAFB; border: 1px solid #EBEBEB; border-radius: 16px; padding: 22px 24px; width: 280px; flex-shrink: 0; }
        .lp-testi-quote { font-size: 15px; line-height: 1.65; color: #333; margin-bottom: 14px; }
        .lp-testi-author { font-size: 12px; font-weight: 600; color: #888; }

        /* 3D mock */
        .lp-3d-wrap { padding: 60px 40px 0; background: #F9FAFB; overflow: hidden; }
        .lp-3d-inner { max-width: 1000px; margin: 0 auto; }
        .mock { background: #18181B; border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); direction: ltr; }
        .mock-titlebar { background: #111; padding: 14px 20px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid rgba(255,255,255,0.07); direction: ltr; }
        .mock-dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0; }
        .mock-dot.r { background: #FF5F57; } .mock-dot.y { background: #FFBD2E; } .mock-dot.g { background: #28CA41; }
        .mock-url { margin: 0 auto; background: #1E1E1E; border: 1px solid rgba(255,255,255,0.07); border-radius: 6px; padding: 5px 20px; font-size: 11px; color: #666; font-family: 'Courier New', monospace; }
        .mock-body { display: grid; grid-template-columns: 220px 1fr; direction: ltr; }
        .mock-sidebar { background: #111; border-right: 1px solid rgba(255,255,255,0.06); padding: 24px 14px; display: flex; flex-direction: column; gap: 3px; }
        .mock-sidebar-header { font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.25); letter-spacing: 0.12em; text-transform: uppercase; padding: 0 10px; margin-bottom: 12px; }
        .mock-nav-item { padding: 9px 14px; border-radius: 8px; font-size: 12.5px; color: #666; cursor: default; display: flex; align-items: center; gap: 10px; }
        .mock-nav-item.active { background: rgba(245,158,11,0.12); color: #F59E0B; font-weight: 600; }
        .mock-nav-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
        .mock-main { padding: 32px; }
        .mock-main-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
        .mock-main-title { font-size: 15px; font-weight: 700; color: #fff; }
        .mock-main-badge { background: rgba(37,211,102,0.12); color: #25D366; border: 1px solid rgba(37,211,102,0.2); font-size: 10px; font-weight: 600; padding: 3px 10px; border-radius: 20px; }
        .mock-stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 28px; }
        .mock-stat { background: #1E1E1E; border-radius: 12px; padding: 20px 22px; border: 1px solid rgba(255,255,255,0.07); }
        .mock-stat-n { font-size: 26px; font-weight: 800; color: #fff; letter-spacing: -1px; margin-bottom: 4px; }
        .mock-stat-n .g { color: #F59E0B; }
        .mock-stat-l { font-size: 11px; color: #555; }
        .mock-stat-trend { font-size: 10px; color: #25D366; margin-top: 6px; }
        .mock-section-title { font-size: 12px; font-weight: 600; color: #555; margin-bottom: 12px; letter-spacing: 0.05em; text-transform: uppercase; }
        .mock-appt-list { display: flex; flex-direction: column; gap: 8px; }
        .mock-appt { background: #1E1E1E; border-radius: 10px; padding: 13px 18px; display: flex; align-items: center; gap: 16px; font-size: 12px; border: 1px solid rgba(255,255,255,0.06); }
        .mock-appt-time { color: #F59E0B; font-weight: 700; font-variant-numeric: tabular-nums; min-width: 36px; }
        .mock-appt-name { color: #fff; font-weight: 600; flex: 1; }
        .mock-appt-service { color: #555; font-size: 11px; }
        .mock-appt-badge { margin-left: auto; font-size: 10px; font-weight: 600; padding: 3px 10px; border-radius: 20px; border: 1px solid; }
        .mock-appt-badge.confirmed { background: rgba(37,211,102,0.1); color: #25D366; border-color: rgba(37,211,102,0.2); }
        .mock-appt-badge.pending { background: rgba(245,158,11,0.1); color: #F59E0B; border-color: rgba(245,158,11,0.2); }

        /* ROI */
        .lp-roi { padding: 100px 40px; background: #0A0A0A; }
        .lp-roi-inner { max-width: 900px; margin: 0 auto; }
        .lp-roi-sub { font-size: 16px; color: rgba(255,255,255,0.5); text-align: center; margin-bottom: 36px; }
        .lp-roi-slider-row { display: flex; align-items: center; gap: 16px; margin-bottom: 32px; }
        .lp-roi-slider-label { font-size: 13px; color: rgba(255,255,255,0.5); white-space: nowrap; }
        .lp-roi-val { font-size: 22px; font-weight: 800; color: #F59E0B; min-width: 40px; text-align: center; }
        .roi-slider { width: 100%; -webkit-appearance: none; height: 4px; border-radius: 2px; outline: none; cursor: pointer; }
        .roi-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px; border-radius: 50%; background: #F59E0B; cursor: pointer; box-shadow: 0 2px 8px rgba(245,158,11,0.5); }
        .lp-roi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 36px; }
        @media (max-width: 800px) { .lp-roi-grid { grid-template-columns: 1fr 1fr; } }
        .lp-roi-cell { padding: 28px 20px; background: #141414; border: 1px solid rgba(255,255,255,0.07); border-radius: 14px; text-align: center; position: relative; }
        .lp-roi-n { font-size: 28px; font-weight: 800; letter-spacing: -1px; margin-bottom: 8px; font-variant-numeric: tabular-nums; }
        .lp-roi-l { font-size: 12px; color: rgba(255,255,255,0.45); line-height: 1.5; }

        /* Pricing */
        .lp-pricing { padding: 100px 40px; background: #fff; }
        .lp-pricing-inner { max-width: 780px; margin: 0 auto; }
        .lp-plans { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
        @media (max-width: 640px) { .lp-plans { grid-template-columns: 1fr; } }
        .lp-plan { border: 1.5px solid #EBEBEB; border-radius: 20px; padding: 36px 32px; }
        .lp-plan.highlight { border-color: #F59E0B; box-shadow: 0 0 0 4px rgba(245,158,11,0.08); }
        .lp-plan-tag { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #888; margin-bottom: 8px; }
        .lp-plan.highlight .lp-plan-tag { color: #F59E0B; }
        .lp-plan-name { font-size: 22px; font-weight: 900; color: #0A0A0A; letter-spacing: -0.5px; margin-bottom: 4px; }
        .lp-plan-price { font-size: 42px; font-weight: 900; color: #0A0A0A; letter-spacing: -2px; line-height: 1; margin-bottom: 2px; }
        .lp-plan-per { font-size: 13px; color: #888; margin-bottom: 24px; }
        .lp-plan-divider { height: 1px; background: #F0F0F0; margin-bottom: 24px; }
        .lp-plan-features { display: flex; flex-direction: column; gap: 10px; margin-bottom: 28px; }
        .lp-plan-feat { font-size: 15px; color: #444; display: flex; align-items: flex-start; gap: 8px; }
        .lp-plan-feat::before { content: "✓"; color: #25D366; font-weight: 700; flex-shrink: 0; }
        .lp-plan-btn { display: block; text-align: center; padding: 13px; border-radius: 10px; font-size: 14px; font-weight: 700; text-decoration: none; transition: opacity 0.15s, transform 0.15s; }
        .lp-plan-btn:hover { opacity: 0.85; transform: translateY(-1px); }
        .lp-plan-btn.dark { background: #111; color: #fff; }
        .lp-plan-btn.amber { background: #F59E0B; color: #000; }

        /* Comparison table */
        .lp-compare { padding: 100px 40px; background: #F9FAFB; }
        .lp-compare-inner { max-width: 900px; margin: 0 auto; overflow-x: auto; }
        .compare-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
        .compare-table th, .compare-table td { padding: 13px 16px; text-align: center; border-bottom: 1px solid #EBEBEB; }
        .compare-table th { font-size: 12px; font-weight: 700; color: #888; letter-spacing: 0.04em; }
        .compare-table td:first-child, .compare-table th:first-child { text-align: left; color: #333; font-weight: 500; }
        .compare-table th.col-tori { background: #1D4ED8; color: #fff; border-radius: 8px 8px 0 0; }
        .col-tori-cell { background: #EFF6FF; }
        .compare-table tbody tr:hover td.col-tori-cell { background: #DBEAFE; }
        .col-badge { display: inline-block; margin-right: 6px; }

        /* FAQ */
        .lp-faq { padding: 100px 40px; background: #fff; }
        .lp-faq-inner { max-width: 720px; margin: 0 auto; }
        .faq-item { border-bottom: 1px solid #F0F0F0; }
        .faq-q { display: flex; justify-content: space-between; align-items: center; padding: 20px 0; cursor: pointer; font-size: 15px; font-weight: 600; color: #111; gap: 16px; }
        .faq-icon { font-size: 20px; color: #999; transition: transform 0.2s; flex-shrink: 0; }
        .faq-a { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
        .faq-a-inner { padding: 0 0 20px; font-size: 15.5px; color: #666; line-height: 1.7; }
        .feat-desc { font-size: 13.5px; }

        /* CTA section */
        .lp-cta { padding: 100px 40px; background: #0A0A0A; text-align: center; }
        .lp-cta-title { font-size: clamp(28px, 5vw, 48px); font-weight: 900; color: #fff; letter-spacing: -2px; margin-bottom: 16px; }
        .lp-cta-sub { font-size: 16px; color: rgba(255,255,255,0.5); margin-bottom: 36px; }
        .lp-cta-row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-bottom: 28px; }
        .lp-cta-trust { display: flex; gap: 20px; justify-content: center; flex-wrap: wrap; }
        .lp-cta-trust-item { font-size: 12px; color: rgba(255,255,255,0.35); }

        /* Footer */
        .lp-footer { background: #0A0A0A; padding: 60px 40px 32px; border-top: 1px solid rgba(255,255,255,0.06); }
        .lp-footer-top { max-width: 1080px; margin: 0 auto 40px; display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 40px; }
        @media (max-width: 700px) { .lp-footer-top { grid-template-columns: 1fr; } }
        .lp-footer-logo-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
        .lp-footer-logo-row img { width: 28px; height: 28px; border-radius: 6px; }
        .lp-footer-brand { font-size: 15px; font-weight: 700; color: #fff; }
        .lp-footer-tagline { font-size: 13px; color: rgba(255,255,255,0.35); line-height: 1.6; max-width: 280px; }
        .lp-footer-col { display: flex; flex-direction: column; gap: 10px; }
        .lp-footer-col h4 { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.3); margin-bottom: 4px; }
        .lp-footer-col a { font-size: 13px; color: rgba(255,255,255,0.45); text-decoration: none; transition: color 0.15s; }
        .lp-footer-col a:hover { color: #fff; }
        .lp-footer-bottom { max-width: 1080px; margin: 0 auto; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 24px; }
        .lp-footer-copy { font-size: 12px; color: rgba(255,255,255,0.25); }
        .lp-footer-copy-link { color: rgba(255,255,255,0.5); text-decoration: underline; text-underline-offset: 2px; }
        .lp-footer-copy-link:hover { color: #25D366; }

        /* Premium */
        .lp-premium { padding: 100px 40px; background: #0A0A0A; }
        .lp-premium-inner { max-width: 1080px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: center; }
        @media (max-width: 800px) { .lp-premium-inner { grid-template-columns: 1fr; } }
        .lp-premium-title { font-size: clamp(28px, 4vw, 44px); font-weight: 900; color: #fff; letter-spacing: -2px; line-height: 1.1; margin-bottom: 20px; }
        .lp-premium-title .amber { color: #F59E0B; }
        .lp-premium-desc { font-size: 16px; color: rgba(255,255,255,0.55); line-height: 1.7; margin-bottom: 24px; }
        .lp-premium-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.25); color: #F59E0B; font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 20px; }
        .voice-card { background: #141414; border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; padding: 28px; }
        .voice-card-title { font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.3); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 20px; }
        .vline { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 16px; font-size: 13px; line-height: 1.5; }
        .vspeaker { font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 10px; white-space: nowrap; margin-top: 2px; }
        .vspeaker.caller { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.4); }
        .vspeaker.ai { background: rgba(245,158,11,0.15); color: #F59E0B; }
        .caller-l { color: rgba(255,255,255,0.7); }
        .ai-l { color: #F59E0B; }

        /* Hamburger */
        .hamburger-btn { display: none; flex-direction: column; gap: 4px; background: none; border: none; cursor: pointer; padding: 6px; border-radius: 6px; }
        @media (max-width: 768px) {
          .hamburger-btn { display: flex; }
          .lp-nav-links, .lp-nav-cta { display: none; }
          .lp-hero { grid-template-columns: 1fr; padding: 80px 24px 40px; }
          .lp-hero-phone { display: none; }
          .lp-stats-band-inner { grid-template-columns: repeat(2,1fr); }
          .lp-feats-grid { grid-template-columns: 1fr; }
          .lp-ba-grid { grid-template-columns: 1fr; }
          .mock-body { grid-template-columns: 1fr; }
          .mock-sidebar { display: none; }
          .lp-plans { grid-template-columns: 1fr; }
          .lp-footer-top { grid-template-columns: 1fr; }
          .lp-premium-inner { grid-template-columns: 1fr; }
          .lp-roi-grid { grid-template-columns: 1fr 1fr; }
        }
        .hamburger-btn span { display: block; width: 20px; height: 1.5px; background: #333; border-radius: 2px; transition: transform 0.2s, opacity 0.2s; }
        .hamburger-btn.open span:nth-child(1) { transform: translateY(5.5px) rotate(45deg); }
        .hamburger-btn.open span:nth-child(2) { opacity: 0; }
        .hamburger-btn.open span:nth-child(3) { transform: translateY(-5.5px) rotate(-45deg); }
        #mobile-nav { position: fixed; top: 62px; left: 0; right: 0; z-index: 190; background: #fff; border-bottom: 1px solid #EBEBEB; display: flex; flex-direction: column; padding: 12px 20px; gap: 4px; transform: translateY(-8px); opacity: 0; pointer-events: none; transition: transform 0.2s, opacity 0.2s; }
        #mobile-nav.open { transform: none; opacity: 1; pointer-events: auto; }
        .mobile-nav-link { font-size: 15px; font-weight: 500; color: #333; text-decoration: none; padding: 10px 8px; border-radius: 8px; }
        .mobile-nav-link:hover { background: #F5F5F5; }
        .mobile-nav-divider { height: 1px; background: #F0F0F0; margin: 6px 0; }
        .mobile-nav-cta { display: block; background: #111; color: #fff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 12px 16px; border-radius: 10px; text-align: center; margin-top: 4px; }
      `}</style>

      <div id="scroll-bar" />

      <a id="sticky-cta" href="/login">
        Start Free — 14 Days
      </a>

      <div className="lp">

        {/* NAV */}
        <nav className="lp-nav">
          <a className="lp-nav-logo" href="/en">
            <img src="/tori_logo_transparent.png" alt="Tori" style={{ width: 32, height: 32, borderRadius: 8 }} />
            <span>Tori</span>
          </a>
          <div className="lp-nav-links">
            <a className="lp-nav-link" href="#how">How it works</a>
            <a className="lp-nav-link" href="#features">Features</a>
            <a className="lp-nav-link" href="#premium">Premium</a>
            <a className="lp-nav-link" href="#pricing">Pricing</a>
            <a className="lp-nav-link" href="#faq">FAQ</a>
          </div>
          <a className="lp-nav-link" href="/" style={{ fontSize: 12, padding: "6px 10px", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 7 }}>🌐 עב</a>
          <a className="lp-nav-cta" href="/login">Dashboard →</a>
          <button id="hamburger-btn" className={`hamburger-btn${menuOpen ? " open" : ""}`} onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
            <span /><span /><span />
          </button>
        </nav>

        {/* Mobile nav */}
        <div id="mobile-nav" className={menuOpen ? "open" : ""}>
          <a className="mobile-nav-link" href="#how" onClick={() => setMenuOpen(false)}>How it works</a>
          <a className="mobile-nav-link" href="#features" onClick={() => setMenuOpen(false)}>Features</a>
          <a className="mobile-nav-link" href="#premium" onClick={() => setMenuOpen(false)}>Premium</a>
          <a className="mobile-nav-link" href="#pricing" onClick={() => setMenuOpen(false)}>Pricing</a>
          <a className="mobile-nav-link" href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a>
          <div className="mobile-nav-divider" />
          <a className="mobile-nav-cta" href="/login">Dashboard →</a>
        </div>

        {/* HERO */}
        <section style={{ background: "#fff", borderBottom: "1px solid #EBEBEB", position: "relative" }}>
          <div id="hero-toast">
            <div className="ht-icon-wrap"><span className="ht-icon">📅</span></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ht-msg">New appointment booked</div>
              <div className="ht-sub">Dana K. · ✂️ Haircut at 11:00 tomorrow</div>
            </div>
            <div className="ht-live">
              <div className="ht-dot" />
              <span className="ht-live-label">Live</span>
            </div>
          </div>
          <div className="lp-hero">
            <div className="lp-hero-text">
              <div className="lp-kicker">
                <span className="lp-kicker-dot" />
                WhatsApp AI · Booking Automation
              </div>
              <h1 className="lp-h1">
                Your business books appointments.<br />
                <span className="green">Even while you sleep.</span>
              </h1>
              <p className="lp-sub">
                Tori is an AI bot that receives WhatsApp messages, understands natural language, schedules appointments, and syncs everything to Google Calendar — automatically.
              </p>
              <div className="lp-hero-btns">
                <a className="btn-green" href="/login">Try Free — 14 Days</a>
                <a className="btn-outline" href="#how">How does it work?</a>
              </div>
              <div className="lp-hero-trust">
                <span className="lp-trust-item-sm"><span className="lp-trust-dot-g" />No credit card required</span>
                <span className="lp-trust-item-sm"><span className="lp-trust-dot-g" />Setup in 10 minutes</span>
                <span className="lp-trust-item-sm"><span className="lp-trust-dot-g" />Cancel anytime</span>
              </div>
            </div>
            <div className="lp-hero-phone">
              <div className="phone-wrap">
                <div className="phone-frame">
                  <div className="phone-island">
                    <div className="phone-island-cam"><div className="phone-island-cam-inner" /></div>
                  </div>
                  <div className="phone-status-bar">
                    <span className="phone-status-time">9:41</span>
                    <div className="phone-status-icons">
                      <svg width="16" height="11" viewBox="0 0 16 11" fill="#111" aria-hidden>
                        <rect x="0" y="7" width="3" height="4" rx="0.6" />
                        <rect x="4.3" y="5" width="3" height="6" rx="0.6" />
                        <rect x="8.6" y="2.5" width="3" height="8.5" rx="0.6" />
                        <rect x="12.9" y="0" width="3" height="11" rx="0.6" />
                      </svg>
                      <svg width="15" height="11" viewBox="0 0 15 11" fill="#111" aria-hidden>
                        <path d="M7.5 2C10.1 2 12.5 3 14.2 4.8l-1.3 1.3C11.5 4.7 9.6 3.9 7.5 3.9S3.5 4.7 2.1 6.1L0.8 4.8C2.5 3 4.9 2 7.5 2z" />
                        <path d="M7.5 5.4c1.6 0 3.1.6 4.2 1.7l-1.3 1.3c-.8-.8-1.8-1.2-2.9-1.2s-2.1.4-2.9 1.2L3.3 7.1C4.4 6 5.9 5.4 7.5 5.4z" />
                        <circle cx="7.5" cy="9.5" r="1.4" />
                      </svg>
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
                      <img src="/tori_logo_transparent.png" alt="Tori" />
                    </div>
                    <div className="phone-wa-info">
                      <div className="phone-wa-name">Tori — Dana's Salon</div>
                      <div className="phone-wa-online">online</div>
                    </div>
                  </div>
                  <div className="phone-chat">
                    <div className="chat-date">Today</div>
                    <div className="chat-bubble incoming" style={{ display: "none" }}>
                      Hi! I'd like to book a haircut for Thursday 🙏
                      <div className="chat-time">22:47 <span className="chat-ticks">✓✓</span></div>
                    </div>
                    <div className="chat-typing" style={{ display: "none" }}>
                      <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
                    </div>
                    <div className="chat-bubble outgoing" style={{ display: "none" }}>
                      Hi! 😊 On Thursday I have openings at 9:30 and 11:00. Which works for you?
                      <div className="chat-time">22:47</div>
                    </div>
                    <div className="chat-bubble incoming" style={{ display: "none" }}>
                      9:30 is perfect
                      <div className="chat-time">22:48 <span className="chat-ticks">✓✓</span></div>
                    </div>
                    <div className="chat-typing" style={{ display: "none" }}>
                      <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
                    </div>
                    <div className="chat-bubble outgoing" style={{ display: "none" }}>
                      Great! ✅ Booked a haircut for Thursday at 9:30. See you then!
                      <div className="chat-time">22:48</div>
                    </div>
                    <div className="chat-bubble incoming" style={{ display: "none" }}>
                      Perfect, thanks! 🙏
                      <div className="chat-time">22:48 <span className="chat-ticks">✓✓</span></div>
                    </div>
                  </div>
                  <div className="phone-wa-input">
                    <div className="phone-wa-input-box">
                      <span className="phone-wa-input-icon">😊</span>
                      Message
                    </div>
                    <div className="phone-wa-send">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* TRUST BAR */}
        <div className="lp-trust-bar">
          <div className="lp-trust-bar-inner">
            <span className="lp-trust-label">Works with</span>
            {[
              { emoji: "💬", text: "WhatsApp Business" },
              { emoji: "📅", text: "Google Calendar" },
              { emoji: "🤖", text: "Claude AI" },
              { emoji: "🔊", text: "ElevenLabs" },
              { emoji: "🔗", text: "OpenAI" },
              { emoji: "📲", text: "Twilio" },
            ].map(({ emoji, text }) => (
              <div key={text} className="lp-trust-logo">
                <span style={{ fontSize: 18 }}>{emoji}</span>
                <span className="lp-trust-logo-text">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* STATS */}
        <div className="lp-stats-band">
          <div className="lp-stats-band-inner">
            {[
              { n: 24, sup: "/7", l: "Available even while you sleep — day and night" },
              { n: 3,  sup: " min", l: "Average setup time until the bot goes live" },
              { n: 0,  sup: "$", l: "Staff training cost — it's fully automated" },
              { n: 100, sup: "%", l: "Of WhatsApp messages answered within seconds" },
            ].map(({ n, sup, l }, i) => (
              <div key={i} className="lp-stat-cell reveal">
                <div className="lp-stat-n">
                  <span className="count-up" data-target={n}>0</span>
                  <span className="accent">{sup}</span>
                </div>
                <div className="lp-stat-l">{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* INTEGRATION FLOW */}
        <section className="lp-flow" id="how">
          <div className="lp-flow-inner">
            <div className="lp-label reveal" style={{ textAlign: "center" }}>Integrations</div>
            <div className="lp-title reveal" style={{ textAlign: "center" }}>Everything connected. You don't have to do anything.</div>
            <div className="lp-flow-steps reveal">
              <div className="lp-flow-node">
                <div className="lp-flow-icon wa">💬<div className="lp-flow-ping green" /></div>
                <div className="lp-flow-label">WhatsApp</div>
                <div className="lp-flow-sub">Customer sends a message</div>
              </div>
              <div className="lp-flow-arrow">→</div>
              <div className="lp-flow-node">
                <div className="lp-flow-icon ai">🤖<div className="lp-flow-ping blue" /></div>
                <div className="lp-flow-label">Tori AI</div>
                <div className="lp-flow-sub">Understands, replies, books</div>
              </div>
              <div className="lp-flow-arrow">→</div>
              <div className="lp-flow-node">
                <div className="lp-flow-icon cal">📅</div>
                <div className="lp-flow-label">Google Calendar</div>
                <div className="lp-flow-sub">Updated automatically</div>
              </div>
              <div className="lp-flow-arrow">→</div>
              <div className="lp-flow-node">
                <div className="lp-flow-icon voice">🎙️</div>
                <div className="lp-flow-label">AI Calls</div>
                <div className="lp-flow-sub">Answers phone too (Premium)</div>
              </div>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS STEPS */}
        <section className="lp-steps">
          <div className="lp-steps-inner">
            <div className="lp-label reveal">Process</div>
            <div className="lp-title reveal">Three steps, then everything runs itself.</div>
            <div className="lp-steps-list">
              {[
                { title: "Customer sends a WhatsApp message", desc: "They write naturally — \"I'd like a haircut Thursday\". The bot understands and replies within a second, in plain English." },
                { title: "The bot offers times and confirms", desc: "It checks the available calendar, suggests slots, gets confirmation and books the appointment — without you touching your phone." },
                { title: "Google Calendar updates automatically", desc: "Every appointment appears instantly in your Google Calendar with the customer's name, service, and end time. One-time setup." },
              ].map((s, i) => (
                <div key={i} className="lp-step reveal" style={{ animationDelay: `${i * 80}ms` }}>
                  <div className="lp-step-num">{i + 1}</div>
                  <div>
                    <div className="lp-step-title">{s.title}</div>
                    <div className="lp-step-desc">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section className="lp-features" id="features">
          <div className="lp-features-inner">
            <div className="lp-label reveal">What's included</div>
            <div className="lp-title reveal">Every tool your business needs — and nothing you don't.</div>
            <div className="lp-feats-grid">
              {[
                { icon: "💬", title: "WhatsApp Bot", desc: "Understands natural language, replies 24/7, and manages the conversation from first message to confirmed booking." },
                { icon: "📅", title: "Google Calendar Sync", desc: "One-time connection. Every booked appointment goes into your calendar automatically with all the details." },
                { icon: "🔔", title: "Automatic Reminders", desc: "The bot sends a reminder to each customer before their appointment. Fewer no-shows, fewer calls." },
                { icon: "📊", title: "Management Dashboard", desc: "Revenue, appointments, customers and popular services — all on one screen, in real time." },
                { icon: "⏰", title: "Flexible Hours", desc: "Set days and hours per service and staff. The bot won't offer times that don't fit your schedule." },
                { icon: "📋", title: "Waitlist", desc: "No availability? The bot adds them to the waitlist and notifies you when a slot opens up." },
              ].map((f) => (
                <div key={f.title} className="lp-feat reveal">
                  <div className="lp-feat-icon">{f.icon}</div>
                  <div className="lp-feat-title">{f.title}</div>
                  <div className="feat-desc">{f.desc}</div>
                </div>
              ))}
            </div>
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
                  <div className="mock-sidebar-header">Manage</div>
                  <div className="mock-nav-item active"><span className="mock-nav-dot" />Appointments</div>
                  <div className="mock-nav-item"><span className="mock-nav-dot" />Customers</div>
                  <div className="mock-nav-item"><span className="mock-nav-dot" />Services</div>
                  <div className="mock-nav-item"><span className="mock-nav-dot" />Analytics</div>
                  <div className="mock-nav-item" style={{ marginTop: "auto" }}><span className="mock-nav-dot" />Settings</div>
                </div>
                <div className="mock-main">
                  <div className="mock-main-header">
                    <div className="mock-main-title">Overview · July 2025</div>
                    <div className="mock-main-badge">● Active</div>
                  </div>
                  <div className="mock-stats-row">
                    <div className="mock-stat">
                      <div className="mock-stat-l" style={{ marginBottom: 6 }}>This month</div>
                      <div className="mock-stat-n">47</div>
                      <div className="mock-stat-trend">↑ 18% vs last month</div>
                    </div>
                    <div className="mock-stat">
                      <div className="mock-stat-l" style={{ marginBottom: 6 }}>Revenue</div>
                      <div className="mock-stat-n"><span className="g">$</span>2,180</div>
                      <div className="mock-stat-trend">↑ $320</div>
                    </div>
                    <div className="mock-stat">
                      <div className="mock-stat-l" style={{ marginBottom: 6 }}>New customers</div>
                      <div className="mock-stat-n">23</div>
                      <div className="mock-stat-trend">↑ 5 this month</div>
                    </div>
                  </div>
                  <div className="mock-section-title">Upcoming Appointments</div>
                  <div className="mock-appt-list">
                    {[
                      { time: "09:30", name: "Dana Cohen", svc: "Haircut", status: "confirmed", label: "Confirmed" },
                      { time: "11:00", name: "Michelle Levy", svc: "Color", status: "confirmed", label: "Confirmed" },
                      { time: "14:30", name: "Joe Abraham", svc: "Haircut + Beard", status: "pending", label: "Pending" },
                      { time: "16:00", name: "Sarah Goldberg", svc: "Facial", status: "confirmed", label: "Confirmed" },
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

        {/* BEFORE / AFTER */}
        <section className="lp-ba">
          <div className="lp-ba-inner">
            <div className="lp-label reveal" style={{ color: "#F87171" }}>Before & After</div>
            <div className="lp-title reveal" style={{ color: "#fff" }}>What changed for businesses that switched to Tori.</div>
            <div className="lp-ba-grid">
              <div className="lp-ba-card before reveal">
                <div className="lp-ba-tag">Before Tori</div>
                <div className="lp-ba-items">
                  {[
                    "Customer sends a message while you're busy — they book somewhere else",
                    "Two hours a day lost to coordinating appointments by phone and WhatsApp",
                    "No-shows because reminders weren't sent",
                    "Google Calendar updated manually — or not at all, causing conflicts",
                    "Phone ringing in the middle of a client",
                  ].map((item) => (
                    <div key={item} className="lp-ba-item"><span className="lp-ba-item-dot" />{item}</div>
                  ))}
                </div>
              </div>
              <div className="lp-ba-card after reveal">
                <div className="lp-ba-tag">With Tori</div>
                <div className="lp-ba-items">
                  {[
                    "Bot replies instantly, 24/7 — even while you sleep at 2am",
                    "Appointments booked automatically with no human touch",
                    "Reminders sent automatically before every appointment",
                    "Google Calendar updated the moment an appointment is booked",
                    "Phone calls answered by AI — on the Premium plan",
                  ].map((item) => (
                    <div key={item} className="lp-ba-item"><span className="lp-ba-item-dot" />{item}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* TESTIMONIALS */}
        <section className="lp-testimonials">
          <div className="lp-testimonials-inner">
            <div className="lp-label reveal" style={{ textAlign: "center" }}>What our customers say</div>
            <div className="lp-title reveal" style={{ textAlign: "center" }}>Business owners already doing it with Tori.</div>
          </div>
          <div className="lp-testi-track-wrap">
            <div className="lp-testi-track">
              {[
                { q: "\"Saved two hours a day on appointment management\"", name: "Dana K., Tel Aviv" },
                { q: "\"Customers are amazed the bot replies at 2am\"", name: "Michelle L., Jerusalem" },
                { q: "\"10 minutes to set up, Google Calendar updates itself\"", name: "Joe H., Haifa" },
                { q: "\"No-shows dropped 80% since we started\"", name: "Sarah M., Ramat Gan" },
                { q: "\"The bot replies faster than I do\"", name: "Amir K., Beer Sheva" },
                { q: "\"Best thing I've done for my business\"", name: "Rachel B., Netanya" },
                { q: "\"Saved two hours a day on appointment management\"", name: "Dana K., Tel Aviv" },
                { q: "\"Customers are amazed the bot replies at 2am\"", name: "Michelle L., Jerusalem" },
                { q: "\"10 minutes to set up, Google Calendar updates itself\"", name: "Joe H., Haifa" },
                { q: "\"No-shows dropped 80% since we started\"", name: "Sarah M., Ramat Gan" },
                { q: "\"The bot replies faster than I do\"", name: "Amir K., Beer Sheva" },
                { q: "\"Best thing I've done for my business\"", name: "Rachel B., Netanya" },
              ].map((t, i) => (
                <div key={i} className="lp-testi-card">
                  <div className="lp-testi-quote">{t.q}</div>
                  <div className="lp-testi-author">— {t.name}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PREMIUM */}
        <section className="lp-premium" id="premium">
          <div className="lp-premium-inner">
            <div>
              <div className="lp-label reveal" style={{ color: "#F59E0B" }}>Premium</div>
              <div className="lp-premium-title reveal">Phone calls too —<br /><span className="amber">the bot answers.</span></div>
              <div className="lp-premium-desc reveal">A customer calls. An AI agent answers in a natural voice, holds the conversation, books the appointment, and syncs to Google Calendar — without you lifting a finger.</div>
              <div className="lp-premium-badge reveal">
                This feature is available in the <strong style={{ marginLeft: 4 }}>Premium plan</strong>
              </div>
            </div>
            <div className="voice-card reveal">
              <div className="voice-card-title">Incoming call</div>
              <div className="vline caller-l"><div className="vspeaker caller">Customer</div>Hi, I'd like to book a haircut Thursday morning</div>
              <div className="vline ai-l"><div className="vspeaker ai">Tori AI</div>Hi! Thursday I have openings at 9:30 and 11:00. Which works?</div>
              <div className="vline caller-l"><div className="vspeaker caller">Customer</div>9:30 is perfect</div>
              <div className="vline ai-l"><div className="vspeaker ai">Tori AI</div>Great. Booked a haircut Thursday at 9:30. You'll get a WhatsApp confirmation.</div>
            </div>
          </div>
        </section>

        {/* ROI CALCULATOR */}
        <section className="lp-roi" id="pricing">
          <div className="lp-roi-inner">
            <div className="lp-label reveal" style={{ textAlign: "center", color: "#F59E0B" }}>Savings calculator</div>
            <div className="lp-title reveal" style={{ color: "#fff", textAlign: "center" }}>How much does Tori save you?</div>
            <div className="lp-roi-sub reveal">Drag the slider to match your weekly appointment count</div>
            <div className="lp-roi-slider-row reveal">
              <span className="lp-roi-slider-label">Appointments per week</span>
              <span className="lp-roi-val">{appts}</span>
              <div style={{ direction: "ltr", flex: 1 }}>
                <input
                  type="range" min={5} max={150} step={5} value={appts}
                  className="roi-slider"
                  style={{ background: `linear-gradient(to right, #F59E0B 0%, #F59E0B ${((appts - 5) / 145) * 100}%, rgba(255,255,255,0.15) ${((appts - 5) / 145) * 100}%, rgba(255,255,255,0.15) 100%)` }}
                  onChange={e => setAppts(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="lp-roi-grid">
              <div className="lp-roi-cell">
                <div className="lp-roi-n" style={{ color: "#F59E0B" }}>{savingsHours}<span style={{ fontSize: 16, color: "rgba(255,255,255,0.4)" }}> hrs</span></div>
                <div className="lp-roi-l">Hours saved per week on manual coordination</div>
              </div>
              <div className="lp-roi-cell">
                <div className="lp-roi-n"><span style={{ color: "#F59E0B" }}>$</span><span style={{ color: "#fff" }}>{extraIncome.toLocaleString()}</span></div>
                <div className="lp-roi-l">Extra monthly income from saved appointments</div>
              </div>
              <div className="lp-roi-cell">
                <div className="lp-roi-n"><span style={{ color: "#F59E0B" }}>$</span><span style={{ color: "#fff" }}>{staffSavings.toLocaleString()}</span></div>
                <div className="lp-roi-l">Monthly savings on phone staff (Premium)</div>
              </div>
              <div className="lp-roi-cell" style={{ position: "relative" }}>
                <div style={{ position: "absolute", top: 8, right: 10, background: "rgba(245,158,11,0.2)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 6, padding: "2px 7px", fontSize: 9, color: "#F59E0B", fontWeight: 700, letterSpacing: "0.06em" }}>PREMIUM</div>
                <div className="lp-roi-n"><span style={{ color: "#F59E0B" }}>$</span><span style={{ color: "#fff" }}>{premiumTotal.toLocaleString()}</span></div>
                <div className="lp-roi-l">Total savings + income with Premium (incl. phone staff)</div>
              </div>
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section className="lp-pricing">
          <div className="lp-pricing-inner">
            <div className="lp-label reveal" style={{ textAlign: "center" }}>Pricing</div>
            <div className="lp-title reveal" style={{ textAlign: "center" }}>Simple. Transparent. No surprises.</div>
            <div className="lp-plans">
              <div className="lp-plan">
                <div className="lp-plan-tag">Standard</div>
                <div className="lp-plan-name">Standard</div>
                <div className="lp-plan-price">$39</div>
                <div className="lp-plan-per">per month · 14-day free trial</div>
                <div className="lp-plan-divider" />
                <div className="lp-plan-features">
                  {["WhatsApp bot, 24/7","Google Calendar auto-sync","Automatic reminders","Full management dashboard","Flexible services, staff & hours","Waitlist","Email support"].map((f) => (
                    <div key={f} className="lp-plan-feat">{f}</div>
                  ))}
                </div>
                <a className="lp-plan-btn dark" href="/login">Start Free Trial</a>
              </div>
              <div className="lp-plan highlight">
                <div className="lp-plan-tag">Premium</div>
                <div className="lp-plan-name">Premium</div>
                <div className="lp-plan-price">$79</div>
                <div className="lp-plan-per">per month · no contract</div>
                <div className="lp-plan-divider" />
                <div className="lp-plan-features">
                  {["Everything in Standard","Incoming phone call handling","Natural AI voice (ElevenLabs)","Automatic call transcription","Sync call appointments to Google Calendar","Priority WhatsApp support","4-hour SLA"].map((f) => (
                    <div key={f} className="lp-plan-feat">{f}</div>
                  ))}
                </div>
                <a className="lp-plan-btn amber" href="/login">Start Free Trial</a>
              </div>
            </div>
          </div>
        </section>

        {/* COMPARISON */}
        <section className="lp-compare">
          <div className="lp-compare-inner">
            <div className="lp-label reveal" style={{ textAlign: "center" }}>Comparison</div>
            <div className="lp-title reveal" style={{ textAlign: "center" }}>Why Tori and not something else?</div>
            <table className="compare-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th className="col-tori"><span className="col-badge">✓</span>Tori</th>
                  <th>Manual</th>
                  <th>Competitors</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { feat: "Available 24/7 — even at 2am", tori: "✓", manual: "✗", other: "✓" },
                  { feat: "Full natural language", tori: "✓", manual: "✓", other: "⚠ Partial" },
                  { feat: "Automatic WhatsApp reminders", tori: "✓", manual: "✗", other: "⚠ SMS paid" },
                  { feat: "Google Calendar sync", tori: "✓", manual: "Manual", other: "⚠ Separate app" },
                  { feat: "Setup in 10 minutes", tori: "✓", manual: "✓", other: "✗ Days" },
                  { feat: "No staff training", tori: "✓", manual: "✓", other: "✗" },
                  { feat: "AI phone answering", tori: "✓ Premium", manual: "✗", other: "✗" },
                  { feat: "Full management dashboard", tori: "✓", manual: "✗", other: "✓" },
                  { feat: "Cancel anytime", tori: "✓", manual: "—", other: "✗ Contract" },
                ].map(({ feat, tori, manual, other }) => (
                  <tr key={feat}>
                    <td>{feat}</td>
                    <td className="col-tori-cell" style={{ fontWeight: 600, color: tori === "✓" ? "#1D4ED8" : tori.includes("Premium") ? "#F59E0B" : "#111" }}>{tori}</td>
                    <td style={{ color: manual === "✗" ? "#EF4444" : "#666" }}>{manual}</td>
                    <td style={{ color: other.startsWith("⚠") ? "#F59E0B" : other === "✗" ? "#EF4444" : "#666" }}>{other}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* FAQ */}
        <section className="lp-faq" id="faq">
          <div className="lp-faq-inner">
            <div className="lp-label reveal" style={{ textAlign: "center" }}>FAQ</div>
            <div className="lp-title reveal" style={{ textAlign: "center" }}>Questions? We have answers.</div>
            <div>
              {[
                { q: "Does the bot understand natural language?", a: "Yes. The bot is powered by Claude AI by Anthropic and understands natural language completely — including abbreviations, typos, and informal phrasing. Customers don't need to type in any special format." },
                { q: "How long does setup take?", a: "On average 3–10 minutes. Connect your WhatsApp Business account, add your services and hours, connect Google Calendar — and the bot is live." },
                { q: "Will customers know it's a bot?", a: "That's up to you. You can configure the bot as a 'smart assistant' for your business and set its personality. Most customers don't notice — but you can also be transparent about it." },
                { q: "What if a customer asks for a service not on the list?", a: "The bot will let the customer know that service isn't available for automatic booking and offer to connect them directly. You can also add custom FAQ answers for common questions." },
                { q: "Does anything need to be installed?", a: "No. Everything runs through the browser — the dashboard is accessible from any device. Customers message through their regular WhatsApp." },
                { q: "Can I cancel anytime?", a: "Yes. No contracts, no cancellation fees. Cancel in one click from the dashboard." },
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

        {/* CTA */}
        <section className="lp-cta reveal">
          <div className="lp-cta-title">Stop answering everyone yourself.</div>
          <div className="lp-cta-sub">Try free for 14 days — no credit card, no risk.</div>
          <div className="lp-cta-row">
            <a className="btn-green" href="/login">Start Free Now</a>
            <a className="btn-outline" style={{ color: "rgba(255,255,255,0.6)", borderColor: "rgba(255,255,255,0.15)" }} href="#pricing">See Pricing</a>
          </div>
          <div className="lp-cta-trust">
            <span className="lp-cta-trust-item">✓ No credit card required</span>
            <span className="lp-cta-trust-item">✓ Cancel anytime</span>
            <span className="lp-cta-trust-item">✓ Setup in 10 minutes</span>
            <span className="lp-cta-trust-item">✓ WhatsApp support</span>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="lp-footer">
          <div className="lp-footer-top">
            <div className="lp-footer-brand-block">
              <div className="lp-footer-logo-row">
                <img src="/tori_logo_transparent.png" alt="Tori" loading="lazy" />
                <span className="lp-footer-brand">Tori</span>
              </div>
              <div className="lp-footer-tagline">Automated appointment booking for small businesses — WhatsApp + AI.</div>
            </div>
            <div className="lp-footer-col">
              <h4>Product</h4>
              <a href="#how">How it works</a>
              <a href="#features">Features</a>
              <a href="#premium">Premium</a>
              <a href="#pricing">Pricing</a>
            </div>
            <div className="lp-footer-col">
              <h4>Help</h4>
              <a href="#faq">FAQ</a>
              <a href="/login">Dashboard</a>
              <a href="/privacy">Privacy Policy</a>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span className="lp-footer-copy">© 2026 torionline.com · All rights reserved · <a href="/privacy" className="lp-footer-copy-link">Privacy Policy</a></span>
            <span className="lp-footer-copy">Made with ❤️ for small business owners</span>
          </div>
        </footer>

      </div>
    </>
  );
}
