"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { clearToken, apiFetch, decodeToken, exitImpersonation } from "../lib/api";
import { useLanguage } from "../lib/LanguageContext";
import { AuthGuard } from "../lib/AuthGuard";

// One nav item. Icons are Heroicons outline path data.
type NavItem = { href: string; key: keyof ReturnType<typeof useLanguage>["t"]["nav"]; icon: string };

const ICONS = {
  analytics: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  appointments: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  customers: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z",
  waitlist: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  services: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  staff: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8zm6 3c0-1.1-.9-2-2-2h-1m-3-1a4 4 0 11-8 0",
  hours: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  faq: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  whatsapp: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z",
  bot: "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z",
  payments: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
  settings: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  billing: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
};

// Grouped by *when you'd reach for it* rather than a flat categorical list, so the order itself
// tells a story: get the bot connected and talking first, then the screens you check day to day,
// then one-time business configuration, then account/money admin. WhatsApp leads every group —
// nothing else on this dashboard does anything until it's connected.
// Grouped for the RETURNING user, not the first-run one (the setup checklist handles onboarding).
// Daily-driver items (analytics, appointments, customers) come first; one-time setup (WhatsApp,
// billing) sinks to the bottom. Bot lives with the rest of the business config it resembles.
const NAV_GROUPS: { titleKey: keyof ReturnType<typeof useLanguage>["t"]["navGroups"]; items: NavItem[] }[] = [
  { titleKey: "overview", items: [{ href: "/dashboard/analytics", key: "analytics", icon: ICONS.analytics }] },
  { titleKey: "operations", items: [
    { href: "/dashboard/appointments", key: "appointments", icon: ICONS.appointments },
    { href: "/dashboard/customers", key: "customers", icon: ICONS.customers },
    { href: "/dashboard/waitlist", key: "waitlist", icon: ICONS.waitlist },
  ] },
  { titleKey: "business", items: [
    { href: "/dashboard/services", key: "services", icon: ICONS.services },
    { href: "/dashboard/staff", key: "staff", icon: ICONS.staff },
    { href: "/dashboard/hours", key: "hours", icon: ICONS.hours },
    { href: "/dashboard/faq", key: "faq", icon: ICONS.faq },
    { href: "/dashboard/bot", key: "bot", icon: ICONS.bot },
  ] },
  { titleKey: "account", items: [
    { href: "/dashboard/whatsapp", key: "whatsapp", icon: ICONS.whatsapp },
    { href: "/dashboard/payments", key: "payments", icon: ICONS.payments },
    { href: "/dashboard/settings", key: "settings", icon: ICONS.settings },
    { href: "/dashboard/billing", key: "billing", icon: ICONS.billing },
  ] },
];

const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
const BOTTOM_TAB_ITEMS = NAV_ITEMS.slice(0, 5);
const MORE_ITEMS = NAV_ITEMS.slice(5);

function ImpersonationBanner() {
  const router = useRouter();
  const { lang } = useLanguage();
  const he = lang === "he";
  const claim = decodeToken();
  if (!claim?.impersonatedBy) return null;

  return (
    <div className="mb-4 bg-amber-500 text-white text-sm font-medium rounded-xl px-4 py-2.5 flex items-center justify-between gap-3">
      <span>👁️ {he ? "צופה כעסק זה (מצב תמיכה)" : "Viewing as this business (support mode)"}</span>
      <button
        onClick={() => {
          if (exitImpersonation()) router.push("/dashboard/admin");
          else router.push("/login");
        }}
        className="bg-white/20 hover:bg-white/30 rounded-lg px-3 py-1 text-xs font-semibold"
      >
        {he ? "יציאה" : "Exit"}
      </button>
    </div>
  );
}

function TrialBanner({ status, createdAt }: { status: string | null; createdAt: string | null }) {
  const { t } = useLanguage();
  if (status !== "trial" || !createdAt) return null;

  const trialEnd = new Date(createdAt).getTime() + 14 * 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil((trialEnd - Date.now()) / (24 * 60 * 60 * 1000));
  const expired = daysLeft <= 0;
  if (!expired && daysLeft > 7) return null; // only nudge as the trial gets close

  return (
    <div
      className="relative overflow-hidden rounded-xl mb-5 px-4 py-3.5 sm:px-5 flex items-center gap-3.5"
      style={{
        background: expired
          ? "linear-gradient(100deg, #B91C1C 0%, #DC2626 100%)"
          : "linear-gradient(100deg, #B45309 0%, #D97706 55%, #F59E0B 100%)",
        boxShadow: expired ? "0 6px 20px rgba(220,38,38,0.25)" : "0 6px 20px rgba(217,119,6,0.22)",
      }}
    >
      {/* subtle decorative glow */}
      <div className="pointer-events-none absolute -top-8 -end-8 w-32 h-32 rounded-full" style={{ background: "rgba(255,255,255,0.12)" }} />
      <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center shrink-0 text-lg">
        {expired ? "⚠️" : "🎁"}
      </div>
      <div className="flex-1 min-w-0">
        {!expired && (
          <div className="text-white font-bold text-sm leading-tight">
            {t.trialDaysLeft(daysLeft)}
          </div>
        )}
        <div className={`text-white/90 leading-snug ${expired ? "font-semibold text-sm" : "text-xs mt-0.5"}`}>
          {expired ? t.trialBannerExpired : t.trialBannerNudge}
        </div>
      </div>
      <Link
        href="/dashboard/billing"
        className="shrink-0 bg-white text-sm font-bold px-4 py-2 rounded-lg transition hover:bg-white/90"
        style={{ color: expired ? "#DC2626" : "#B45309" }}
      >
        {t.subscribeCta}
      </Link>
    </div>
  );
}

function SidebarContent({ pathname, isSuperAdmin }: { pathname: string; isSuperAdmin: boolean }) {
  const router = useRouter();
  const { lang, setLang, t } = useLanguage();

  function logout() {
    clearToken();
    router.push("/login");
  }

  function navLinkStyle(active: boolean) {
    return active
      ? { background: "rgba(27,127,160,0.18)", color: "#fff", boxShadow: "inset 3px 0 0 #1B7FA0" }
      : { color: "rgba(255,255,255,0.45)" };
  }

  return (
    <>
      {/* Brand */}
      <div className="px-3 mb-6">
        <div className="flex items-center gap-3">
          <Image
            src="/tori_logo-white.jpeg"
            alt="תורי"
            width={46}
            height={46}
            className="rounded-xl shrink-0"
            style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}
          />
          <div>
            <div className="font-bold text-base text-white leading-tight tracking-tight">תורי</div>
            <div className="text-[10px] leading-none mt-0.5 font-medium" style={{ color: "rgba(255,255,255,0.25)", letterSpacing: "0.03em" }}>הזמנת תורים בוואטסאפ</div>
          </div>
        </div>
      </div>

      <nav className="flex flex-col gap-4 flex-1 overflow-y-auto sidebar-scroll pb-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.titleKey} className="flex flex-col gap-0.5">
            <div className="px-3 mb-1">
              <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.34)", textTransform: "uppercase" }}>
                {t.navGroups[group.titleKey]}
              </span>
            </div>
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all"
                  style={navLinkStyle(active)}
                  onMouseEnter={(e) => { if (!active) { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.85)"; } }}
                  onMouseLeave={(e) => { if (!active) { (e.currentTarget as HTMLElement).style.background = ""; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.45)"; } }}
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ opacity: active ? 1 : 0.7 }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.5 : 1.75} d={item.icon} />
                  </svg>
                  <span className="truncate">{t.nav[item.key]}</span>
                </Link>
              );
            })}
          </div>
        ))}

        {isSuperAdmin && (
          <div className="flex flex-col gap-0.5">
            <div className="px-3 mb-1">
              <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(232,184,75,0.6)", textTransform: "uppercase" }}>Admin</span>
            </div>
            {[
              { href: "/dashboard/admin", label: "Admin", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
              { href: "/dashboard/admin/leads", label: "מציאת לידים", icon: "M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition"
                style={pathname === item.href ? { background: "rgba(192,138,0,0.18)", color: "#E8B84B" } : { color: "rgba(255,255,255,0.3)" }}
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={item.icon} />
                </svg>
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </nav>

      <div className="mt-3 pt-3 flex flex-col gap-1" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
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
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.75)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.3)"; }}
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
  const router = useRouter();
  const { t } = useLanguage();
  const activeItem = NAV_ITEMS.find((item) => item.href === pathname);
  const [moreOpen, setMoreOpen] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [trial, setTrial] = useState<{ status: string; createdAt: string } | null>(null);

  // Single source of truth for the /me lookup — TrialBanner, the sidebar, and the mobile "More"
  // sheet all need bits of it, so fetch once here and pass down instead of three separate calls.
  useEffect(() => {
    apiFetch<{ isSuperAdmin?: boolean; subscriptionStatus: string; createdAt: string; businessTypeChosenAt?: string | null }>("/api/business/me")
      .then((me) => {
        setIsSuperAdmin(Boolean(me.isSuperAdmin));
        setTrial({ status: me.subscriptionStatus, createdAt: me.createdAt });
        // First-login category picker: if the owner hasn't chosen a vertical yet, send them to the
        // onboarding cards once (skip if they're already there, to avoid a redirect loop).
        if (!me.businessTypeChosenAt && pathname !== "/dashboard/onboarding") {
          router.replace("/dashboard/onboarding");
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMoreOpen(false); // close the sheet on navigation
  }, [pathname]);

  function logout() {
    clearToken();
    router.push("/login");
  }

  const moreActive = MORE_ITEMS.some((i) => i.href === pathname) || pathname.startsWith("/dashboard/admin");

  return (
    <AuthGuard>
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
        <SidebarContent pathname={pathname} isSuperAdmin={isSuperAdmin} />
      </aside>

      {/* Mobile top bar */}
      <div
        className="md:hidden fixed top-0 start-0 end-0 z-30 flex items-center px-4 h-14"
        style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(12px)", borderBottom: "1px solid #E5E7EB" }}
      >
        <div className="flex items-center gap-2.5">
          <Image src="/tori_logo-white.jpeg" alt="תורי" width={36} height={36} className="rounded-lg" />
          <span className="font-semibold text-gray-900 text-base">
            {activeItem ? t.nav[activeItem.key] : "תורי"}
          </span>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 md:ms-64 p-4 pt-[4.5rem] pb-24 md:p-8 md:pt-8 md:pb-8 overflow-auto">
        <ImpersonationBanner />
        <TrialBanner status={trial?.status ?? null} createdAt={trial?.createdAt ?? null} />
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

        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="flex-1 flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition"
          style={{ color: moreOpen || moreActive ? "#1B7FA0" : "#9CA3AF" }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span>עוד</span>
        </button>
      </nav>

      {/* "More" bottom sheet — remaining nav items that don't fit the 5-tab bar */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-16 start-0 end-0 bg-white rounded-t-2xl shadow-2xl p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] max-h-[70vh] overflow-y-auto"
          >
            <div className="w-9 h-1 rounded-full bg-gray-200 mx-auto mb-2" />
            {/* Mirror the sidebar's grouping so the mobile sheet reads as sections, not a flat list */}
            {NAV_GROUPS.map((group) => {
              const items = group.items.filter((i) => MORE_ITEMS.includes(i));
              if (items.length === 0) return null;
              return (
                <div key={group.titleKey}>
                  <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
                    {t.navGroups[group.titleKey]}
                  </div>
                  {items.map((item) => {
                    const active = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition ${active ? "bg-[#1B7FA0]/10 text-[#1B7FA0]" : "text-gray-700"}`}
                      >
                        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={item.icon} />
                        </svg>
                        {t.nav[item.key]}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
            {isSuperAdmin && (
              <>
                <Link
                  href="/dashboard/admin"
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition ${pathname === "/dashboard/admin" ? "bg-amber-50 text-amber-700" : "text-gray-700"}`}
                >
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Admin
                </Link>
                <Link
                  href="/dashboard/admin/leads"
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition ${pathname === "/dashboard/admin/leads" ? "bg-amber-50 text-amber-700" : "text-gray-700"}`}
                >
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
                  </svg>
                  מציאת לידים
                </Link>
              </>
            )}
            <div className="h-px bg-gray-100 my-2" />
            <button
              onClick={logout}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-gray-600 transition"
            >
              <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {t.nav.logout}
            </button>
          </div>
        </div>
      )}
    </div>
    </AuthGuard>
  );
}
