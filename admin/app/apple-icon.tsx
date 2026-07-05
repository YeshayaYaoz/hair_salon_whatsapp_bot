import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS home-screen icon (PNG required — SVG isn't supported there).
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #1B7FA0 0%, #145F78 100%)",
        }}
      >
        <div
          style={{
            width: 84,
            height: 46,
            borderLeft: "18px solid #fff",
            borderBottom: "18px solid #fff",
            transform: "rotate(-45deg)",
            marginTop: -16,
          }}
        />
      </div>
    ),
    { ...size }
  );
}
