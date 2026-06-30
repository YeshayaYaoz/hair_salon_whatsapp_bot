import type { ReactNode } from "react";
import { Heebo, Karantina } from "next/font/google";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  variable: "--font-heebo",
  display: "swap",
});

const karantina = Karantina({
  weight: ["400", "700"],
  subsets: ["hebrew", "latin"],
  variable: "--font-karantina",
  display: "swap",
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" className={`dark ${heebo.variable} ${karantina.variable}`}>
      <body className="bg-zinc-950 text-zinc-100 min-h-screen font-[family-name:var(--font-heebo)]">
        {children}
      </body>
    </html>
  );
}
