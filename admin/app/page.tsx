"use client";

export default function LandingPage() {
  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --ivory:      #EEEAE4;
          --ivory-dark: #E4E0D8;
          --ink:        #141410;
          --ink-mid:    #58584E;
          --ink-dim:    #9A9A8C;
          --forest:     #0C2018;
          --forest-mid: #142E1E;
          --green:      #25D366;
          --green-dim:  #1A9448;
          --border:     #D8D4CC;
        }
        html { scroll-behavior: smooth; }
        .lp-root {
          background: var(--ivory);
          color: var(--ink);
          font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
          font-size: 16px;
          line-height: 1.5;
          direction: rtl;
          -webkit-font-smoothing: antialiased;
          min-height: 100vh;
        }
        .lp-nav {
          position: fixed;
          inset-block-start: 0;
          inset-inline: 0;
          z-index: 200;
          height: 60px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 48px;
          background: var(--ivory);
          border-bottom: 1px solid var(--border);
        }
        .lp-logo {
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 22px;
          font-style: italic;
          font-weight: bold;
          color: var(--ink);
          letter-spacing: -0.5px;
          text-decoration: none;
        }
        .lp-nav-right {
          display: flex;
          align-items: center;
          gap: 20px;
        }
        .lp-nav-link {
          font-size: 13px;
          color: var(--ink-mid);
          text-decoration: none;
          transition: color 0.15s;
        }
        .lp-nav-link:hover { color: var(--ink); }
        .btn-sharp {
          background: var(--forest);
          color: #fff;
          border: none;
          padding: 10px 22px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          letter-spacing: 0.03em;
          border-radius: 0;
          transition: background 0.15s;
          text-decoration: none;
          display: inline-block;
        }
        .btn-sharp:hover { background: var(--forest-mid); }
        .lp-hero {
          min-height: 100vh;
          padding-top: 60px;
          display: grid;
          grid-template-columns: 55fr 45fr;
          max-width: 1300px;
          margin: 0 auto;
        }
        .lp-hero-copy {
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 80px 60px 80px 80px;
        }
        .eyebrow {
          font-family: 'Courier New', Courier, monospace;
          font-size: 11px;
          letter-spacing: 0.14em;
          color: var(--green-dim);
          text-transform: uppercase;
          margin-bottom: 28px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .eyebrow::before {
          content: '';
          width: 24px;
          height: 1px;
          background: var(--green-dim);
          display: inline-block;
          flex-shrink: 0;
        }
        .lp-h1 {
          font-family: Georgia, 'Times New Roman', serif;
          font-style: italic;
          font-weight: bold;
          font-size: clamp(48px, 5.5vw, 80px);
          line-height: 1.02;
          letter-spacing: -2.5px;
          color: var(--ink);
          text-wrap: balance;
          margin-bottom: 24px;
        }
        .lp-h1 em {
          font-style: normal;
          color: var(--forest);
        }
        .hero-sub {
          font-size: 17px;
          line-height: 1.75;
          color: var(--ink-mid);
          max-width: 420px;
          margin-bottom: 44px;
        }
        .hero-actions {
          display: flex;
          align-items: center;
          gap: 28px;
          flex-wrap: wrap;
        }
        .btn-green {
          background: var(--green);
          color: var(--forest);
          border: none;
          padding: 14px 30px;
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
          border-radius: 0;
          letter-spacing: 0.02em;
          transition: opacity 0.15s;
          text-decoration: none;
          display: inline-block;
        }
        .btn-green:hover { opacity: 0.88; }
        .ghost-link {
          font-size: 14px;
          color: var(--ink-mid);
          text-decoration: none;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: color 0.15s;
        }
        .ghost-link:hover { color: var(--ink); }
        .ghost-link::after { content: '←'; font-size: 13px; }
        .lp-hero-visual {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 80px 60px;
          border-right: 1px solid var(--border);
        }
        .phone {
          width: 268px;
          border: 2px solid var(--ink);
          border-radius: 36px;
          overflow: hidden;
          box-shadow: 9px 9px 0 var(--ink);
          position: relative;
          z-index: 1;
        }
        .phone-notch {
          position: absolute;
          top: 0; left: 50%; transform: translateX(-50%);
          width: 80px; height: 26px;
          background: var(--ink);
          border-radius: 0 0 16px 16px;
          z-index: 2;
        }
        .phone-header {
          background: #075E54;
          padding: 30px 14px 12px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .phone-avatar {
          width: 34px; height: 34px;
          border-radius: 50%;
          background: var(--green);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: Georgia, serif;
          font-style: italic;
          font-weight: bold;
          font-size: 14px;
          color: #fff;
          flex-shrink: 0;
        }
        .phone-info { flex: 1; }
        .phone-name { font-size: 13px; font-weight: 600; color: #fff; }
        .phone-online { font-size: 10px; color: rgba(255,255,255,0.6); }
        .phone-body {
          background: #E5DDD5;
          min-height: 340px;
          padding: 14px 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .bbl {
          max-width: 80%;
          padding: 7px 11px;
          font-size: 12.5px;
          line-height: 1.5;
          border-radius: 7px;
          opacity: 0;
          transform: translateY(5px);
          transition: opacity 0.28s ease, transform 0.28s ease;
          direction: rtl;
        }
        .bbl.show { opacity: 1; transform: none; }
        .bbl.recv { background: #fff; align-self: flex-end; border-bottom-right-radius: 2px; color: #111; }
        .bbl.sent { background: #DCF8C6; align-self: flex-start; border-bottom-left-radius: 2px; color: #111; }
        .bbl-ts { font-size: 9px; color: #aaa; margin-top: 2px; direction: ltr; }
        .stats-row {
          display: flex;
          border-top: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
        }
        .stat-cell {
          flex: 1;
          padding: 36px 52px;
          border-left: 1px solid var(--border);
        }
        .stat-cell:last-child { border-left: none; }
        .stat-n {
          font-family: Georgia, serif;
          font-style: italic;
          font-size: 48px;
          font-weight: bold;
          letter-spacing: -3px;
          line-height: 1;
          color: var(--ink);
          font-variant-numeric: tabular-nums;
          margin-bottom: 4px;
        }
        .stat-n span { font-size: 24px; letter-spacing: -1px; }
        .stat-l { font-size: 13px; color: var(--ink-mid); }
        .lp-dark {
          background: var(--forest);
          color: #fff;
        }
        .dark-inner {
          max-width: 1200px;
          margin: 0 auto;
          padding: 96px 80px;
          display: grid;
          grid-template-columns: 5fr 7fr;
          gap: 96px;
          align-items: start;
        }
        .dark-label {
          font-family: 'Courier New', monospace;
          font-size: 11px;
          letter-spacing: 0.14em;
          color: var(--green);
          text-transform: uppercase;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .dark-label::before {
          content: '';
          width: 24px; height: 1px;
          background: var(--green);
          flex-shrink: 0;
        }
        .dark-title {
          font-family: Georgia, serif;
          font-style: italic;
          font-weight: bold;
          font-size: clamp(34px, 3.5vw, 52px);
          line-height: 1.08;
          letter-spacing: -1.5px;
          color: #fff;
          text-wrap: balance;
        }
        .feat-list { display: flex; flex-direction: column; }
        .feat {
          padding: 22px 0;
          border-bottom: 1px solid rgba(255,255,255,0.07);
          display: grid;
          grid-template-columns: 6px 1fr;
          gap: 16px;
          align-items: start;
          opacity: 0;
          transform: translateY(10px);
          transition: opacity 0.4s ease, transform 0.4s ease;
        }
        .feat:first-child { border-top: 1px solid rgba(255,255,255,0.07); }
        .feat.show { opacity: 1; transform: none; }
        .feat-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: var(--green);
          margin-top: 8px;
          flex-shrink: 0;
        }
        .feat-title { font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 3px; }
        .feat-desc { font-size: 13px; color: rgba(255,255,255,0.45); line-height: 1.6; }
        .lp-voice {
          max-width: 1200px;
          margin: 0 auto;
          padding: 96px 80px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 80px;
          align-items: center;
        }
        .section-label {
          font-family: 'Courier New', monospace;
          font-size: 11px;
          letter-spacing: 0.14em;
          color: var(--ink-dim);
          text-transform: uppercase;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .section-label::before {
          content: '';
          width: 24px; height: 1px;
          background: var(--ink-dim);
          flex-shrink: 0;
        }
        .lp-h2 {
          font-family: Georgia, serif;
          font-style: italic;
          font-weight: bold;
          font-size: clamp(30px, 3vw, 46px);
          line-height: 1.08;
          letter-spacing: -1.5px;
          color: var(--ink);
          text-wrap: balance;
          margin-bottom: 18px;
        }
        .body-text { font-size: 16px; color: var(--ink-mid); line-height: 1.75; margin-bottom: 32px; }
        .transcript-card {
          background: var(--ivory-dark);
          border: 1px solid var(--border);
          border-top: 3px solid var(--ink);
          padding: 28px;
        }
        .tc-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding-bottom: 18px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 20px;
        }
        .live-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          background: var(--green);
          animation: blink 2s infinite;
          flex-shrink: 0;
        }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        .tc-title { font-size: 12px; font-weight: 600; color: var(--ink); }
        .tc-duration { font-size: 11px; color: var(--ink-dim); font-family: 'Courier New', monospace; margin-right: auto; }
        .tc-lines { display: flex; flex-direction: column; gap: 14px; }
        .tc-line { font-size: 13px; line-height: 1.55; }
        .tc-speaker {
          font-family: 'Courier New', monospace;
          font-size: 9.5px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-bottom: 2px;
        }
        .tc-speaker.caller { color: var(--ink-dim); }
        .tc-speaker.ai { color: var(--green-dim); }
        .tc-line.caller-line { color: var(--ink-mid); }
        .tc-line.ai-line { color: var(--ink); font-weight: 500; }
        .tc-line {
          opacity: 0;
          transform: translateX(6px);
          transition: opacity 0.35s, transform 0.35s;
        }
        .tc-line.show { opacity: 1; transform: none; }
        .cal-strip {
          background: var(--forest);
          color: #fff;
          padding: 64px 80px;
          display: flex;
          align-items: center;
          gap: 64px;
          justify-content: center;
        }
        .cal-copy { max-width: 380px; }
        .cal-label {
          font-family: 'Courier New', monospace;
          font-size: 11px;
          letter-spacing: 0.14em;
          color: var(--green);
          text-transform: uppercase;
          margin-bottom: 16px;
        }
        .cal-title {
          font-family: Georgia, serif;
          font-style: italic;
          font-size: 28px;
          font-weight: bold;
          letter-spacing: -1px;
          line-height: 1.1;
          color: #fff;
          margin-bottom: 12px;
        }
        .cal-desc { font-size: 14px; color: rgba(255,255,255,0.5); line-height: 1.65; }
        .cal-mock {
          background: #fff;
          border: 2px solid rgba(255,255,255,0.15);
          width: 260px;
          flex-shrink: 0;
          box-shadow: 6px 6px 0 rgba(255,255,255,0.1);
        }
        .cal-hdr {
          background: #1A73E8;
          padding: 10px 14px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .cal-hdr-dot { width: 8px; height: 8px; border-radius: 50%; background: #fff; opacity: 0.9; }
        .cal-hdr-text { font-size: 11px; font-weight: 600; color: #fff; }
        .cal-body { padding: 12px; direction: rtl; }
        .cal-days-hdr {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 2px;
          margin-bottom: 4px;
        }
        .cal-dh { text-align: center; font-size: 9px; font-weight: 600; color: #70757A; padding: 2px; }
        .cal-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
        .cal-d {
          aspect-ratio: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          color: #3C4043;
          border-radius: 50%;
          position: relative;
        }
        .cal-d.today { background: #1A73E8; color: #fff; font-weight: 700; }
        .cal-d.has::after {
          content: '';
          position: absolute;
          bottom: 1px;
          width: 3px; height: 3px;
          background: #34A853;
          border-radius: 50%;
        }
        .cal-event {
          margin: 2px 8px 3px;
          padding: 4px 7px;
          border-radius: 3px;
          font-size: 10px;
          font-weight: 600;
          direction: rtl;
        }
        .cal-event.green { background: #E6F4EA; color: #1E8E3E; }
        .cal-event.blue { background: #E8F0FE; color: #1A73E8; }
        .cal-event-new {
          margin: 4px 8px 10px;
          padding: 6px 7px;
          border: 1px dashed #1A73E8;
          border-radius: 3px;
          font-size: 10px;
          color: #1A73E8;
          direction: rtl;
          display: flex;
          align-items: center;
          gap: 5px;
          animation: slideIn 0.5s ease 2s both;
        }
        @keyframes slideIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
        .new-dot { width: 5px; height: 5px; border-radius: 50%; background: #1A73E8; flex-shrink: 0; animation: blink 2s infinite; }
        .lp-cta {
          background: var(--ink);
          padding: 100px 80px;
          text-align: center;
        }
        .lp-cta .lp-h2 {
          font-family: Georgia, serif;
          font-style: italic;
          font-size: clamp(36px, 5vw, 64px);
          font-weight: bold;
          letter-spacing: -2.5px;
          color: #fff;
          text-wrap: balance;
          margin-bottom: 14px;
        }
        .cta-sub { font-size: 16px; color: rgba(255,255,255,0.45); margin-bottom: 40px; }
        .btn-cta-green {
          background: var(--green);
          color: var(--forest);
          border: none;
          padding: 16px 38px;
          font-size: 15px;
          font-weight: 800;
          cursor: pointer;
          border-radius: 0;
          letter-spacing: 0.02em;
          transition: opacity 0.15s;
          display: inline-block;
          text-decoration: none;
        }
        .btn-cta-green:hover { opacity: 0.88; }
        .lp-footer {
          background: var(--ink);
          border-top: 1px solid rgba(255,255,255,0.07);
          padding: 22px 80px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .footer-logo { font-family: Georgia, serif; font-style: italic; font-weight: bold; font-size: 18px; color: #fff; letter-spacing: -0.5px; }
        .footer-copy { font-size: 12px; color: rgba(255,255,255,0.3); }
        @media (max-width: 900px) {
          .lp-nav { padding: 0 20px; }
          .lp-hero { grid-template-columns: 1fr; min-height: auto; }
          .lp-hero-copy { padding: 56px 20px 40px; }
          .lp-hero-visual { display: none; }
          .stats-row { flex-direction: column; }
          .stat-cell { border-left: none; border-bottom: 1px solid var(--border); padding: 24px 20px; }
          .dark-inner { grid-template-columns: 1fr; padding: 60px 20px; gap: 48px; }
          .lp-voice { grid-template-columns: 1fr; padding: 60px 20px; gap: 48px; }
          .cal-strip { flex-direction: column; padding: 60px 20px; gap: 40px; }
          .cal-mock { width: 100%; max-width: 300px; }
          .lp-cta { padding: 72px 20px; }
          .lp-footer { padding: 20px; flex-direction: column; gap: 8px; text-align: center; }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
        }
      `}</style>

      <div className="lp-root">
      {/* NAV */}
      <nav className="lp-nav">
        <a className="lp-logo" href="#">תורי</a>
        <div className="lp-nav-right">
          <a className="lp-nav-link" href="#features">תכונות</a>
          <a className="btn-sharp" href="/login">כניסה לדשבורד</a>
        </div>
      </nav>

      {/* HERO */}
      <section className="lp-hero">
        <div className="lp-hero-copy">
          <div className="eyebrow">בוט הזמנות חכם לסלונים וקליניקות</div>
          <h1 className="lp-h1">
            הסלון שלך<br />
            <em>עונה לבד.</em>
          </h1>
          <p className="hero-sub">
            לקוח שולח הודעה בוואטסאפ — הבוט עונה, מציע זמנים, קובע תור.
            גוגל קלנדר מתעדכן. הכל קורה בלי שנגעת בטלפון.
          </p>
          <div className="hero-actions">
            <a className="btn-green" href="/login">התחל בחינם</a>
            <a className="ghost-link" href="#features">ראה איך זה עובד</a>
          </div>
        </div>

        <div className="lp-hero-visual">
          <div className="phone-wrap" style={{ position: 'relative' }}>
            <div className="phone">
              <div className="phone-notch"></div>
              <div className="phone-header">
                <div className="phone-avatar">ת</div>
                <div className="phone-info">
                  <div className="phone-name">תורי — עוזר חכם</div>
                  <div className="phone-online">מחובר</div>
                </div>
              </div>
              <div className="phone-body" id="phoneBody"></div>
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <div className="stats-row">
        <div className="stat-cell">
          <div className="stat-n">24<span>/7</span></div>
          <div className="stat-l">זמין לקבלת תורים</div>
        </div>
        <div className="stat-cell">
          <div className="stat-n">3<span>min</span></div>
          <div className="stat-l">זמן הקמה ממוצע</div>
        </div>
        <div className="stat-cell">
          <div className="stat-n">0<span>₪</span></div>
          <div className="stat-l">עלות הכשרה לצוות</div>
        </div>
      </div>

      {/* DARK FEATURES */}
      <div className="lp-dark" id="features">
        <div className="dark-inner">
          <div>
            <div className="dark-label">מה כלול</div>
            <div className="dark-title">כל כלי שסלון<br />מצליח צריך.</div>
          </div>
          <div className="feat-list" id="featList">
            <div className="feat">
              <div className="feat-dot"></div>
              <div>
                <div className="feat-title">הזמנות דרך WhatsApp</div>
                <div className="feat-desc">הבוט מבין עברית טבעית, מציע זמנים פנויים ומאשר תורים — אוטומטי לחלוטין.</div>
              </div>
            </div>
            <div className="feat">
              <div className="feat-dot"></div>
              <div>
                <div className="feat-title">סנכרון גוגל קלנדר</div>
                <div className="feat-desc">כל תור שנקבע מופיע מיידית בגוגל קלנדר שלך עם שם הלקוח והשירות.</div>
              </div>
            </div>
            <div className="feat">
              <div className="feat-dot"></div>
              <div>
                <div className="feat-title">עונה גם לטלפון</div>
                <div className="feat-desc">סוכן AI מנהל שיחה טבעית עם הלקוח וקובע תור — בלי שתרים אצבע.</div>
              </div>
            </div>
            <div className="feat">
              <div className="feat-dot"></div>
              <div>
                <div className="feat-title">תזכורות אוטומטיות</div>
                <div className="feat-desc">הבוט שולח תזכורות לפני התור — פחות no-shows, יותר הכנסה.</div>
              </div>
            </div>
            <div className="feat">
              <div className="feat-dot"></div>
              <div>
                <div className="feat-title">דשבורד ניהול</div>
                <div className="feat-desc">הכנסות, תורים, לקוחות ושירותים פופולריים — הכל במקום אחד.</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* VOICE SECTION */}
      <section className="lp-voice">
        <div>
          <div className="section-label">חדש</div>
          <h2 className="lp-h2">גם שיחות טלפון —<br />הבוט עונה.</h2>
          <p className="body-text">
            לקוח מתקשר לסלון. הבוט AI עונה בקול טבעי, מנהל שיחה, קובע תור — ומסנכרן לגוגל קלנדר.
            אתה לא צריך לענות לאף שיחה.
          </p>
          <a className="btn-sharp" href="/login">נסה בחינם</a>
        </div>

        <div className="transcript-card">
          <div className="tc-header">
            <div className="live-dot"></div>
            <div>
              <div className="tc-title">שיחה נכנסת</div>
              <div className="tc-duration">00:42</div>
            </div>
          </div>
          <div className="tc-lines" id="tcLines">
            <div className="tc-line caller-line">
              <div className="tc-speaker caller">לקוח</div>
              שלום, רציתי לקבוע תספורת ליום חמישי בבוקר
            </div>
            <div className="tc-line ai-line">
              <div className="tc-speaker ai">תורי AI</div>
              שלום! ביום חמישי יש לי פנוי ב-9:30 וב-11:00. מה מתאים?
            </div>
            <div className="tc-line caller-line">
              <div className="tc-speaker caller">לקוח</div>
              9:30 בסדר גמור
            </div>
            <div className="tc-line ai-line">
              <div className="tc-speaker ai">תורי AI</div>
              מעולה. קבעתי תספורת ביום חמישי ב-9:30. תקבל אישור בוואטסאפ.
            </div>
          </div>
        </div>
      </section>

      {/* CALENDAR STRIP */}
      <div className="cal-strip">
        <div className="cal-copy">
          <div className="cal-label">אינטגרציה</div>
          <div className="cal-title">גוגל קלנדר מתעדכן לבד</div>
          <div className="cal-desc">כל תור שנקבע — בין אם דרך וואטסאפ ובין אם בטלפון — מופיע אוטומטית בגוגל קלנדר שלך. חיבור חד-פעמי, סנכרון לנצח.</div>
        </div>

        <div className="cal-mock">
          <div className="cal-hdr">
            <div className="cal-hdr-dot"></div>
            <div className="cal-hdr-text">Google Calendar — יולי 2026</div>
          </div>
          <div className="cal-body">
            <div className="cal-days-hdr">
              <div className="cal-dh">א</div><div className="cal-dh">ב</div><div className="cal-dh">ג</div>
              <div className="cal-dh">ד</div><div className="cal-dh">ה</div><div className="cal-dh">ו</div><div className="cal-dh">ש</div>
            </div>
            <div className="cal-days">
              <div className="cal-d" style={{color:'#ccc'}}></div>
              <div className="cal-d" style={{color:'#ccc'}}></div>
              <div className="cal-d">1</div>
              <div className="cal-d has">2</div>
              <div className="cal-d has">3</div>
              <div className="cal-d">4</div>
              <div className="cal-d" style={{color:'#bbb'}}>5</div>
              <div className="cal-d">6</div>
              <div className="cal-d has">7</div>
              <div className="cal-d has">8</div>
              <div className="cal-d today">9</div>
              <div className="cal-d has">10</div>
              <div className="cal-d">11</div>
              <div className="cal-d" style={{color:'#bbb'}}>12</div>
              <div className="cal-d">13</div>
              <div className="cal-d has">14</div>
              <div className="cal-d">15</div>
              <div className="cal-d has">16</div>
              <div className="cal-d has">17</div>
              <div className="cal-d">18</div>
              <div className="cal-d" style={{color:'#bbb'}}>19</div>
            </div>
            <div className="cal-event green">דנה כהן — תספורת 09:30</div>
            <div className="cal-event blue">מיכל לוי — צבע 11:00</div>
            <div className="cal-event-new">
              <div className="new-dot"></div>
              נוסף אוטו׳ — יוסי 14:30
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="lp-cta">
        <h2 className="lp-h2">מוכן להפסיק לענות לכולם?</h2>
        <p className="cta-sub">ניסיון חינם. אין צורך בכרטיס אשראי. הקמה תוך 3 דקות.</p>
        <a className="btn-cta-green" href="/login">התחל עכשיו</a>
      </div>

      {/* FOOTER */}
      <footer className="lp-footer">
        <div className="footer-logo">תורי</div>
        <div className="footer-copy">© 2026 תורי · torionline.com</div>
      </footer>

      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          var msgs = [
            { t: 'recv', text: 'היי, אני רוצה תור לתספורת' },
            { t: 'sent', text: 'שלום! 😊 לאיזה יום מתאים?' },
            { t: 'recv', text: 'ראשון אחה"צ אם אפשר' },
            { t: 'sent', text: 'יש פנוי ב-15:00 וב-16:30.\\nמה עדיף?' },
            { t: 'recv', text: '15:00 מושלם' },
            { t: 'sent', text: '✅ נקבע!\\nתספורת — ראשון 15:00\\nאישור בדרך אליך.' },
          ];
          var tss = ['10:21','10:21','10:22','10:22','10:23','10:23'];
          var i = 0;
          function nextBubble() {
            var body = document.getElementById('phoneBody');
            if (!body) return;
            if (i >= msgs.length) {
              setTimeout(function() { body.innerHTML = ''; i = 0; setTimeout(nextBubble, 600); }, 3500);
              return;
            }
            var m = msgs[i];
            var el = document.createElement('div');
            el.className = 'bbl ' + m.t;
            el.innerHTML = m.text.replace(/\\n/g,'<br>') + '<div class="bbl-ts">' + tss[i] + '</div>';
            body.appendChild(el);
            requestAnimationFrame(function() { requestAnimationFrame(function() { el.classList.add('show'); }); });
            i++;
            setTimeout(nextBubble, m.t === 'sent' ? 1500 : 1100);
          }
          setTimeout(nextBubble, 500);

          var featObs = new IntersectionObserver(function(entries) {
            if (!entries[0].isIntersecting) return;
            document.querySelectorAll('.feat').forEach(function(el, idx) {
              setTimeout(function() { el.classList.add('show'); }, idx * 120);
            });
            featObs.disconnect();
          }, { threshold: 0.2 });
          var featList = document.getElementById('featList');
          if (featList) featObs.observe(featList);

          var tcObs = new IntersectionObserver(function(entries) {
            if (!entries[0].isIntersecting) return;
            document.querySelectorAll('.tc-line').forEach(function(el, idx) {
              setTimeout(function() { el.classList.add('show'); }, idx * 550 + 200);
            });
            tcObs.disconnect();
          }, { threshold: 0.3 });
          var tcLines = document.getElementById('tcLines');
          if (tcLines) tcObs.observe(tcLines);
        })();
      ` }} />
    </>
  );
}
