"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode } from "react";
import { clearToken } from "../lib/api";
import { useLanguage } from "../lib/LanguageContext";

const NAV_ITEMS = [
  { href: "/dashboard/analytics",    key: "analytics"    as const, icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
  { href: "/dashboard/appointments", key: "appointments" as const, icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { href: "/dashboard/customers",    key: "customers"    as const, icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" },
  { href: "/dashboard/waitlist",     key: "waitlist"     as const, icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
  { href: "/dashboard/services",     key: "services"     as const, icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { href: "/dashboard/staff",        key: "staff"        as const, icon: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8zm6 3c0-1.1-.9-2-2-2h-1m-3-1a4 4 0 11-8 0" },
  { href: "/dashboard/hours",        key: "hours"        as const, icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
  { href: "/dashboard/whatsapp",     key: "whatsapp"     as const, icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" },
  { href: "/dashboard/faq",          key: "faq"          as const, icon: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { href: "/dashboard/settings",     key: "settings"     as const, icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
  { href: "/dashboard/billing",      key: "billing"      as const, icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" },
];

// First 5 items shown in mobile bottom tab bar
const BOTTOM_TAB_ITEMS = NAV_ITEMS.slice(0, 5);

function SidebarContent({ pathname }: { pathname: string }) {
  const router = useRouter();
  const { lang, setLang, t } = useLanguage();

  function logout() {
    clearToken();
    router.push("/");
  }

  return (
    <>
      {/* Brand */}
      <div className="px-4 mb-6">
        <div className="flex items-center gap-3">
          <Image
            src="/tori-logo.png"
            alt="תורי"
            width={44}
            height={44}
            className="rounded-xl shrink-0 drop-shadow-lg"
          />
          <div>
            <div className="font-bold text-lg text-white leading-tight">תורי</div>
            <div className="text-[11px] text-zinc-500 leading-none mt-0.5">הזמנת תורים בוואטסאפ</div>
          </div>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                active
                  ? "bg-violet-600/20 text-violet-400"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              }`}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
              </svg>
              <span className="truncate">{t.nav[item.key]}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 pt-4 border-t border-zinc-800 flex flex-col gap-1">
        {/* Language toggle */}
        <div className="flex items-center gap-1 px-3 py-1.5">
          <span className="text-xs text-zinc-600 me-1">🌐</span>
          {(["en", "he"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`text-xs px-2 py-0.5 rounded-md font-medium transition ${
                lang === l ? "bg-violet-600/20 text-violet-400" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {l === "en" ? "EN" : "עב"}
            </button>
          ))}
        </div>

        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
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
    <div className="flex min-h-screen bg-zinc-950">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 bg-zinc-900 border-e border-zinc-800 flex-col py-6 px-2 shrink-0 fixed top-0 bottom-0 start-0 z-20">
        <SidebarContent pathname={pathname} />
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 start-0 end-0 z-30 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 flex items-center px-4 h-14">
        <div className="flex items-center gap-2.5">
          <Image src="/tori-logo.png" alt="תורי" width={32} height={32} className="rounded-lg" />
          <span className="font-semibold text-white text-base">
            {activeItem ? t.nav[activeItem.key] : "תורי"}
          </span>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 md:ms-60 p-4 pt-[4.5rem] pb-24 md:p-8 md:pt-8 md:pb-8 overflow-auto">
        {children}
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 start-0 end-0 z-30 bg-zinc-900/95 backdrop-blur border-t border-zinc-800 flex items-stretch h-16 safe-area-pb">
        {BOTTOM_TAB_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition ${
                active ? "text-violet-400" : "text-zinc-500"
              }`}
            >
              <svg
                className={`w-5 h-5 transition ${active ? "text-violet-400" : "text-zinc-500"}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.5 : 2} d={item.icon} />
              </svg>
              <span className="truncate max-w-[56px] text-center leading-tight">
                {t.nav[item.key]}
              </span>
            </Link>
          );
        })}

        {/* More button linking to first non-tab item */}
        <Link
          href="/dashboard/staff"
          className={`flex-1 flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition ${
            !BOTTOM_TAB_ITEMS.find(i => i.href === pathname) && pathname !== "/" ? "text-violet-400" : "text-zinc-500"
          }`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span>עוד</span>
        </Link>
      </nav>
    </div>
  );
}
