"use client";

import { useEffect, useRef } from "react";

export default function LandingPage() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // Intersection observer for step/feature reveals
    const els = document.querySelectorAll(".reveal");
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { (e.target as HTMLElement).style.opacity = "1"; (e.target as HTMLElement).style.transform = "none"; } }),
      { threshold: 0.12 }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
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
        }

        /* NAV */
        .lp-nav {
          position: fixed;
          top: 0; left: 0; right: 0;
          z-index: 100;
          height: 64px;
          background: rgba(255,255,255,0.92);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid #EBEBEB;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 40px;
        }
        .lp-nav-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
        }
        .lp-nav-logo img {
          width: 32px;
          height: 32px;
          border-radius: 8px;
        }
        .lp-nav-logo-text {
          font-size: 17px;
          font-weight: 700;
          color: #111;
          letter-spacing: -0.3px;
        }
        .lp-nav-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .lp-btn-ghost {
          font-size: 14px;
          font-weight: 500;
          color: #444;
          text-decoration: none;
          padding: 8px 16px;
          border-radius: 8px;
          transition: background 0.15s;
        }
        .lp-btn-ghost:hover { background: #F5F5F5; }
        .lp-btn-primary {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
          background: #111;
          text-decoration: none;
          padding: 9px 20px;
          border-radius: 8px;
          transition: opacity 0.15s;
        }
        .lp-btn-primary:hover { opacity: 0.82; }

        /* HERO */
        .lp-hero {
          padding-top: 64px;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding-left: 24px;
          padding-right: 24px;
          background: #fff;
        }
        .lp-hero-kicker {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #F0FFF4;
          border: 1px solid #C6F6D5;
          color: #276749;
          font-size: 12px;
          font-weight: 600;
          padding: 5px 12px;
          border-radius: 20px;
          margin-bottom: 28px;
          letter-spacing: 0.02em;
        }
        .lp-hero-kicker-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: #25D366;
        }
        .lp-h1 {
          font-size: clamp(40px, 6vw, 72px);
          font-weight: 800;
          line-height: 1.05;
          letter-spacing: -2.5px;
          color: #0A0A0A;
          max-width: 800px;
          margin: 0 auto 20px;
        }
        .lp-h1 .accent { color: #25D366; }
        .lp-hero-sub {
          font-size: clamp(16px, 2vw, 19px);
          color: #555;
          line-height: 1.7;
          max-width: 520px;
          margin: 0 auto 40px;
          font-weight: 400;
        }
        .lp-hero-ctas {
          display: flex;
          align-items: center;
          gap: 12px;
          justify-content: center;
          flex-wrap: wrap;
          margin-bottom: 64px;
        }
        .lp-cta-green {
          background: #25D366;
          color: #fff;
          font-size: 15px;
          font-weight: 700;
          padding: 13px 28px;
          border-radius: 10px;
          text-decoration: none;
          transition: opacity 0.15s, transform 0.15s;
          display: inline-block;
          letter-spacing: -0.1px;
        }
        .lp-cta-green:hover { opacity: 0.88; transform: translateY(-1px); }
        .lp-cta-outline {
          background: transparent;
          color: #333;
          font-size: 15px;
          font-weight: 500;
          padding: 13px 24px;
          border-radius: 10px;
          border: 1px solid #DDD;
          text-decoration: none;
          transition: border-color 0.15s, background 0.15s;
          display: inline-block;
        }
        .lp-cta-outline:hover { border-color: #999; background: #FAFAFA; }

        /* VIDEO FRAME */
        .lp-video-frame {
          width: 100%;
          max-width: 420px;
          margin: 0 auto;
          border-radius: 20px;
          overflow: hidden;
          border: 1px solid #E8E8E8;
          box-shadow: 0 20px 60px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.05);
          background: #000;
        }
        .lp-video-frame video {
          width: 100%;
          display: block;
        }

        /* LOGOS / TRUST */
        .lp-trust {
          background: #FAFAFA;
          border-top: 1px solid #EBEBEB;
          border-bottom: 1px solid #EBEBEB;
          padding: 22px 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 48px;
          flex-wrap: wrap;
        }
        .lp-trust-label {
          font-size: 12px;
          color: #999;
          font-weight: 500;
          white-space: nowrap;
        }
        .lp-trust-items {
          display: flex;
          align-items: center;
          gap: 32px;
          flex-wrap: wrap;
        }
        .lp-trust-item {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 13px;
          color: #555;
          font-weight: 500;
        }
        .lp-trust-icon {
          width: 18px;
          height: 18px;
          flex-shrink: 0;
        }

        /* STEPS */
        .lp-steps {
          padding: 100px 40px;
          max-width: 1080px;
          margin: 0 auto;
        }
        .lp-section-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #25D366;
          margin-bottom: 12px;
        }
        .lp-section-title {
          font-size: clamp(28px, 3.5vw, 44px);
          font-weight: 800;
          letter-spacing: -1.5px;
          color: #0A0A0A;
          margin-bottom: 56px;
          line-height: 1.1;
        }
        .lp-steps-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 2px;
          border: 1px solid #EBEBEB;
          border-radius: 14px;
          overflow: hidden;
        }
        .lp-step {
          padding: 40px 36px;
          background: #fff;
          border-left: 1px solid #EBEBEB;
          opacity: 0;
          transform: translateY(16px);
          transition: opacity 0.5s ease, transform 0.5s ease;
        }
        .lp-step:last-child { border-left: none; }
        .lp-step-num {
          font-size: 13px;
          font-weight: 700;
          color: #25D366;
          font-variant-numeric: tabular-nums;
          margin-bottom: 20px;
          letter-spacing: 0.05em;
        }
        .lp-step-title {
          font-size: 17px;
          font-weight: 700;
          color: #111;
          margin-bottom: 10px;
          letter-spacing: -0.3px;
          line-height: 1.3;
        }
        .lp-step-desc {
          font-size: 14px;
          color: #666;
          line-height: 1.7;
        }

        /* FEATURES */
        .lp-features {
          background: #F8F8F8;
          border-top: 1px solid #EBEBEB;
          border-bottom: 1px solid #EBEBEB;
          padding: 100px 40px;
        }
        .lp-features-inner {
          max-width: 1080px;
          margin: 0 auto;
        }
        .lp-features-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px;
          margin-top: 56px;
        }
        .lp-feat {
          background: #fff;
          border: 1px solid #E8E8E8;
          border-radius: 12px;
          padding: 28px 26px;
          opacity: 0;
          transform: translateY(16px);
          transition: opacity 0.45s ease, transform 0.45s ease;
        }
        .lp-feat-icon {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 16px;
          font-size: 18px;
          background: #F0FFF4;
        }
        .lp-feat-title {
          font-size: 15px;
          font-weight: 700;
          color: #111;
          margin-bottom: 6px;
          letter-spacing: -0.2px;
        }
        .lp-feat-desc {
          font-size: 13px;
          color: #666;
          line-height: 1.65;
        }

        /* CTA STRIP */
        .lp-cta-strip {
          background: #0A0A0A;
          padding: 96px 40px;
          text-align: center;
        }
        .lp-cta-strip-title {
          font-size: clamp(28px, 4vw, 52px);
          font-weight: 800;
          color: #fff;
          letter-spacing: -2px;
          margin-bottom: 12px;
          line-height: 1.1;
        }
        .lp-cta-strip-sub {
          font-size: 16px;
          color: rgba(255,255,255,0.45);
          margin-bottom: 36px;
          font-weight: 400;
        }

        /* FOOTER */
        .lp-footer {
          background: #0A0A0A;
          border-top: 1px solid rgba(255,255,255,0.07);
          padding: 24px 40px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .lp-footer-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .lp-footer-left img { width: 24px; height: 24px; border-radius: 6px; opacity: 0.7; }
        .lp-footer-brand { font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.5); }
        .lp-footer-copy { font-size: 12px; color: rgba(255,255,255,0.25); }

        /* RESPONSIVE */
        @media (max-width: 768px) {
          .lp-nav { padding: 0 20px; }
          .lp-nav-logo-text { display: none; }
          .lp-steps-grid { grid-template-columns: 1fr; border-radius: 12px; }
          .lp-step { border-left: none; border-bottom: 1px solid #EBEBEB; }
          .lp-step:last-child { border-bottom: none; }
          .lp-features-grid { grid-template-columns: 1fr 1fr; gap: 12px; }
          .lp-steps { padding: 72px 20px; }
          .lp-features { padding: 72px 20px; }
          .lp-cta-strip { padding: 72px 20px; }
          .lp-footer { padding: 20px; flex-direction: column; gap: 8px; }
          .lp-trust { padding: 20px; gap: 16px; }
        }
        @media (max-width: 480px) {
          .lp-features-grid { grid-template-columns: 1fr; }
        }
        @media (prefers-reduced-motion: reduce) {
          .reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
        }
      `}</style>

      <div className="lp">
        {/* NAV */}
        <nav className="lp-nav">
          <a className="lp-nav-logo" href="#">
            <img src="/tori-logo-black.png" alt="תורי" />
            <span className="lp-nav-logo-text">תורי</span>
          </a>
          <div className="lp-nav-actions">
            <a className="lp-btn-ghost" href="#how">איך זה עובד</a>
            <a className="lp-btn-primary" href="/login">כניסה לדשבורד ←</a>
          </div>
        </nav>

        {/* HERO */}
        <section className="lp-hero">
          <div className="lp-hero-kicker">
            <span className="lp-hero-kicker-dot" />
            מחובר ל-WhatsApp ול-Google Calendar
          </div>
          <h1 className="lp-h1">
            הסלון שלך מקבל תורים<br />
            <span className="accent">בזמן שאתה עובד.</span>
          </h1>
          <p className="lp-hero-sub">
            בוט AI מנהל את ההזמנות דרך WhatsApp — עונה, מציע זמנים, קובע, שולח תזכורות.
            כל תור מסתנכרן ישירות לגוגל קלנדר שלך.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-cta-green" href="/login">התחל בחינם</a>
            <a className="lp-cta-outline" href="#how">ראה איך זה עובד</a>
          </div>

          {/* Logo / Brand video */}
          <div className="lp-video-frame">
            <video
              ref={videoRef}
              autoPlay
              muted
              loop
              playsInline
              style={{ background: "#000" }}
            >
              <source src="/logo_animation_black.mp4" type="video/mp4" />
            </video>
          </div>
        </section>

        {/* TRUST BAR */}
        <div className="lp-trust">
          <span className="lp-trust-label">עובד עם הכלים שאתה כבר משתמש בהם</span>
          <div className="lp-trust-items">
            <div className="lp-trust-item">
              <svg className="lp-trust-icon" viewBox="0 0 24 24" fill="none">
                <path d="M17.6 6.31a7.97 7.97 0 00-5.6-2.31A8 8 0 004 12a8 8 0 008 8 7.97 7.97 0 006.63-3.54l-1.58-1.11A5.97 5.97 0 0112 18a6 6 0 010-12c1.53 0 2.93.58 3.98 1.52L13 10.5h6V4.5l-1.4 1.81z" fill="#25D366"/>
              </svg>
              WhatsApp Business
            </div>
            <div className="lp-trust-item">
              <svg className="lp-trust-icon" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Google Calendar
            </div>
            <div className="lp-trust-item">
              <svg className="lp-trust-icon" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              דשבורד ניהול
            </div>
            <div className="lp-trust-item">
              <svg className="lp-trust-icon" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              תזכורות אוטומטיות
            </div>
          </div>
        </div>

        {/* HOW IT WORKS */}
        <section className="lp-steps" id="how">
          <div className="lp-section-label">תהליך</div>
          <div className="lp-section-title">שלושה צעדים. הכל קורה לבד.</div>
          <div className="lp-steps-grid">
            <div className="lp-step reveal">
              <div className="lp-step-num">01</div>
              <div className="lp-step-title">לקוח שולח הודעה ב-WhatsApp</div>
              <div className="lp-step-desc">הלקוח כותב לסלון בשפה רגילה — "רוצה תספורת ביום חמישי". הבוט מבין ועונה תוך שנייה.</div>
            </div>
            <div className="lp-step reveal">
              <div className="lp-step-num">02</div>
              <div className="lp-step-title">הבוט מציע זמנים ומאשר</div>
              <div className="lp-step-desc">הבוט בודק את היומן הפנוי, מציע מועדים, מקבל אישור — וקובע את התור. בלי שנגעת בטלפון.</div>
            </div>
            <div className="lp-step reveal">
              <div className="lp-step-num">03</div>
              <div className="lp-step-title">גוגל קלנדר מתעדכן אוטומטית</div>
              <div className="lp-step-desc">כל תור שנקבע מופיע מיידית בגוגל קלנדר שלך עם שם הלקוח, השירות, ושעת הסיום.</div>
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section className="lp-features">
          <div className="lp-features-inner">
            <div className="lp-section-label">מה כלול</div>
            <div className="lp-section-title">כל מה שסלון או קליניקה צריכים.</div>
            <div className="lp-features-grid">
              <div className="lp-feat reveal">
                <div className="lp-feat-icon">💬</div>
                <div className="lp-feat-title">בוט WhatsApp בעברית</div>
                <div className="lp-feat-desc">מבין שפה טבעית, עונה ב-24/7, ומנהל שיחה אמיתית עם הלקוח מתחילה ועד אישור התור.</div>
              </div>
              <div className="lp-feat reveal">
                <div className="lp-feat-icon">📅</div>
                <div className="lp-feat-title">סנכרון גוגל קלנדר</div>
                <div className="lp-feat-desc">חיבור חד-פעמי בלחיצה. כל תור שנקבע — בין אם בוואטסאפ ובין אם בטלפון — נכנס ליומן אוטומטית.</div>
              </div>
              <div className="lp-feat reveal">
                <div className="lp-feat-icon">🔔</div>
                <div className="lp-feat-title">תזכורות לפני התור</div>
                <div className="lp-feat-desc">הבוט שולח הודעת תזכורת ללקוח לפני כל תור. פחות no-shows, פחות טלפונים אליך.</div>
              </div>
              <div className="lp-feat reveal">
                <div className="lp-feat-icon">📊</div>
                <div className="lp-feat-title">דשבורד ניהול</div>
                <div className="lp-feat-desc">הכנסות חודשיות, תורים קרובים, לקוחות, שירותים פופולריים — הכל במסך אחד.</div>
              </div>
              <div className="lp-feat reveal">
                <div className="lp-feat-icon">⏰</div>
                <div className="lp-feat-title">שעות פתיחה גמישות</div>
                <div className="lp-feat-desc">הגדר ימים ושעות לכל צוות ושירות. הבוט לא יציע זמנים שלא מתאימים לך.</div>
              </div>
              <div className="lp-feat reveal">
                <div className="lp-feat-icon">📋</div>
                <div className="lp-feat-title">רשימת המתנה</div>
                <div className="lp-feat-desc">אין זמינות? הבוט מוסיף את הלקוח לרשימת המתנה ומיידע אותך כשמשהו מתפנה.</div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <div className="lp-cta-strip">
          <div className="lp-cta-strip-title">מוכן? זה לוקח 3 דקות.</div>
          <div className="lp-cta-strip-sub">ניסיון חינם. אין צורך בכרטיס אשראי.</div>
          <a className="lp-cta-green" href="/login">התחל עכשיו</a>
        </div>

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
