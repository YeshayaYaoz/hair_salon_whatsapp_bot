"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { clearToken, apiFetch } from "../lib/api";
import { useLanguage } from "../lib/LanguageContext";
import { AuthGuard } from "../lib/AuthGuard";

function TrialBanner() {
  const { t } = useLanguage();
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<{ subscriptionStatus: string; createdAt: string }>("/api/business/me")
      .then((me) => {
        if (me.subscriptionStatus !== "trial") return;
        const trialEnd = new Date(me.createdAt).getTime() + 14 * 24 * 60 * 60 * 1000;
        const days = Math.ceil((trialEnd - Date.now()) / (24 * 60 * 60 * 1000));
        setDaysLeft(days);
      })
      .catch(() => {});
  }, []);

  if (daysLeft === null) return null;

  const expired = daysLeft <= 0;
  if (!expired && daysLeft > 5) return null; // only show when close

  return (
    <div className={`fixed top-0 start-0 end-0 z-50 flex items-center justify-between gap-3 px-4 py-2 text-xs font-medium ${expired ? "bg-red-600 text-white" : "bg-amber-500 text-white"}`}>
      <span>{expired ? t.trialBannerExpired : (t.trialBanner as (d: number) => string)(daysLeft)}</span>
      <Link href="/dashboard/billing" className="shrink-0 underline underline-offset-2 hover:no-underline">{t.subscribeCta}</Link>
    </div>
  );
}

const NAV_ITEMS = [
  { href: "/dashboard/analytics",    key: "analytics"    as const, icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
  { href: "/dashboard/appointments", key: "appointments" as const, icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { href: "/dashboard/customers",    key: "customers"    as const, icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" },
  { href: "/dashboard/waitlist",     key: "waitlist"     as const, icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
  { href: "/dashboard/services",     key: "services"     as const, icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { href: "/dashboard/staff",        key: "staff"        as const, icon: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8zm6 3c0-1.1-.9-2-2-2h-1m-3-1a4 4 0 11-8 0" },
  { href: "/dashboard/hours",        key: "hours"        as const, icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
  { href: "/dashboard/whatsapp",     key: "whatsapp"     as const, icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" },
  { href: "/dashboard/payments",     key: "payments"     as const, icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" },
  { href: "/dashboard/faq",          key: "faq"          as const, icon: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { href: "/dashboard/settings",     key: "settings"     as const, icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
  { href: "/dashboard/billing",      key: "billing"      as const, icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" },
];

const BOTTOM_TAB_ITEMS = NAV_ITEMS.slice(0, 5);

function SidebarContent({ pathname }: { pathname: string }) {
  const router = useRouter();
  const { lang, setLang, t } = useLanguage();

  function logout() {
    clearToken();
    router.push("/login");
  }

  return (
    <>
      {/* Brand */}
      <div className="px-3 mb-8">
        <div className="flex items-center gap-3">
          <Image
            src="/tori_logo-white.jpeg"
            alt="תורי"
            width={38}
            height={38}
            className="rounded-xl shrink-0"
            style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}
          />
          <div>
            <div className="font-bold text-base text-white leading-tight tracking-tight">תורי</div>
            <div className="text-[10px] leading-none mt-0.5 font-medium" style={{ color: "rgba(255,255,255,0.25)", letterSpacing: "0.03em" }}>הזמנת תורים בוואטסאפ</div>
          </div>
        </div>
      </div>

      {/* Section label */}
      <div className="px-3 mb-1.5">
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.18)", textTransform: "uppercase" }}>ניהול</span>
      </div>

      <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto sidebar-scroll">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all"
              style={active ? {
                background: "rgba(27,127,160,0.18)",
                color: "#fff",
                boxShadow: "inset 3px 0 0 #1B7FA0",
              } : {
                color: "rgba(255,255,255,0.45)",
              }}
              onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.85)"; } }}
              onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = ""; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.45)"; } }}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ opacity: active ? 1 : 0.7 }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.5 : 1.75} d={item.icon} />
              </svg>
              <span className="truncate">{t.nav[item.key]}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 pt-4 flex flex-col gap-1" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        {/* Language toggle */}
        <div className="flex items-center gap-1 px-3 py-1.5">
          <span className="text-xs me-1" style={{ color: "rgba(255,255,255,0.2)" }}>🌐</span>
          {(["en", "he"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className="text-xs px-2 py-0.5 rounded-md font-medium transition"
              style={lang === l ? { background: "rgba(27,127,160,0.25)", color: "#5BB8D4" } : { color: "rgba(255,255,255,0.3)" }}
            >
              {l === "en" ? "EN" : "עב"}
            </button>
          ))}
        </div>

        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition"
          style={{ color: "rgba(255,255,255,0.3)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.75)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ""; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.3)"; }}
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          {t.nav.logout}
        </button>
      </div>
    </>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const activeItem = NAV_ITEMS.find((item) => item.href === pathname);

  return (
    <AuthGuard>
    <TrialBanner />
    <div className="flex min-h-screen" style={{ background: "#F4F6F8" }}>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex w-64 flex-col py-7 px-3 shrink-0 fixed top-0 bottom-0 start-0 z-20"
        style={{
          background: "linear-gradient(180deg, #0B2030 0%, #0D2A38 100%)",
          borderInlineEnd: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "4px 0 24px rgba(0,0,0,0.15)",
        }}
      >
        <SidebarContent pathname={pathname} />
      </aside>

      {/* Mobile top bar */}
      <div
        className="md:hidden fixed top-0 start-0 end-0 z-30 flex items-center px-4 h-14"
        style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(12px)", borderBottom: "1px solid #E5E7EB" }}
      >
        <div className="flex items-center gap-2.5">
          <Image src="/tori_logo-white.jpeg" alt="תורי" width={30} height={30} className="rounded-lg" />
          <span className="font-semibold text-gray-900 text-base">
            {activeItem ? t.nav[activeItem.key] : "תורי"}
          </span>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 md:ms-64 p-4 pt-[4.5rem] pb-24 md:p-8 md:pt-8 md:pb-8 overflow-auto">
        {children}
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        className="md:hidden fixed bottom-0 start-0 end-0 z-30 flex items-stretch h-16"
        style={{ background: "rgba(255,255,255,0.97)", backdropFilter: "blur(12px)", borderTop: "1px solid #E5E7EB" }}
      >
        {BOTTOM_TAB_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition"
              style={{ color: active ? "#1B7FA0" : "#9CA3AF" }}
            >
              <svg
                className="w-5 h-5 transition"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                style={{ color: active ? "#1B7FA0" : "#9CA3AF" }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.5 : 1.75} d={item.icon} />
              </svg>
              <span className="truncate max-w-[56px] text-center leading-tight">
                {t.nav[item.key]}
              </span>
            </Link>
          );
        })}

        <Link
          href="/dashboard/staff"
          className="flex-1 flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition"
          style={{ color: !BOTTOM_TAB_ITEMS.find(i => i.href === pathname) && pathname !== "/" ? "#1B7FA0" : "#9CA3AF" }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span>עוד</span>
        </Link>
      </nav>
    </div>
    </AuthGuard>
  );
}
