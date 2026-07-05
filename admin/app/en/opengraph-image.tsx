import { ImageResponse } from "next/og";

export const alt = "Tori — Automatic appointment booking via WhatsApp AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #0D2A38 0%, #1B7FA0 100%)",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 40 }}>
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 28,
              background: "#25D366",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 40,
                height: 22,
                borderLeft: "8px solid #fff",
                borderBottom: "8px solid #fff",
                transform: "rotate(-45deg)",
                marginTop: -8,
              }}
            />
          </div>
          <div style={{ fontSize: 72, fontWeight: 800, letterSpacing: -2 }}>Tori</div>
        </div>

        <div style={{ fontSize: 60, fontWeight: 800, lineHeight: 1.1, maxWidth: 900 }}>
          AI WhatsApp bot that books appointments automatically
        </div>
        <div style={{ fontSize: 32, color: "rgba(255,255,255,0.8)", marginTop: 28, maxWidth: 850 }}>
          Answers clients 24/7 · Books & reminds · Syncs to Google Calendar
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 56 }}>
          <div style={{ width: 12, height: 12, borderRadius: 6, background: "#25D366" }} />
          <div style={{ fontSize: 28, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>torionline.com</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
