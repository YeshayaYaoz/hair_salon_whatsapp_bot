"use client";

import { useEffect } from "react";

// Catches errors thrown in the root layout itself, where the normal error.tsx boundary
// can't help because it renders inside that same layout. Must render its own <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Root layout error:", error);
    // Client monitoring init lives in LanguageProvider, which is itself inside the layout
    // that just failed — so this reports via a fresh, minimal init rather than relying on it.
    import("./lib/sentry").then(({ initClientMonitoring, reportClientError }) => {
      initClientMonitoring();
      reportClientError(error);
    });
  }, [error]);

  return (
    <html lang="he" dir="rtl">
      <body style={{ background: "#F4F6F8", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif" }}>
        <div style={{ textAlign: "center", maxWidth: 360, padding: "0 24px" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 8 }}>משהו השתבש</h1>
          <p style={{ fontSize: 14, color: "#6B7280", marginBottom: 32, lineHeight: 1.6 }}>
            אירעה שגיאה בלתי צפויה. נסה לרענן את הדף.
          </p>
          <button
            onClick={reset}
            style={{ background: "#1B7FA0", color: "#fff", fontSize: 14, fontWeight: 600, padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer" }}
          >
            נסה שוב
          </button>
        </div>
      </body>
    </html>
  );
}
