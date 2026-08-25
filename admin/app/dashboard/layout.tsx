"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { clearToken, apiFetch, decodeToken, exitImpersonation, reloadAs } from "../lib/api";
import { useLanguage } from "../lib/LanguageContext";
import { AuthGuard } from "../lib/AuthGuard";
import { useNextSetupStep } from "../lib/useNextSetupStep";
import { SectionTabs } from "../lib/SectionTabs";
import { SECTION_FOLLOWER_HREFS } from "../lib/sections";
import { useDialog } from "../lib/useDialog";

// One nav item. Icons are Heroicons outline path data.
// hideFor: verticals where this destination is meaningless. An overnight rental has no staff
// performing a service and no opening hours gating bookings — in inquiry mode there is no slot
// engine for hours to constrain — so showing either is noise the owner has to learn to ignore.
type NavItem = {
  href: string;
  key: keyof ReturnType<typeof useLanguage>["t"]["nav"];
  icon: string;
  hideFor?: string[];
};

const ICONS = {
  analytics: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  appointments: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  customers: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z",
  // Distinct from `hours`, which is the clock: these two sat next to each other in the nav with
  // byte-identical paths, so "waitlist" and "schedule" were indistinguishable at a glance.
  // This one is a queue of people waiting.
  waitlist: "M17 20h5v-2a3 3 0 00-5.36-1.86M17 20H7m10 0v-2c0-.66-.13-1.29-.36-1.86m0 0a5 5 0 00-9.28 0M7 20H2v-2a3 3 0 015.36-1.86M7 20v-2c0-.66.13-1.29.36-1.86m0 0a5 5 0 019.28 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  services: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  staff: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8zm6 3c0-1.1-.9-2-2-2h-1m-3-1a4 4 0 11-8 0",
  hours: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  faq: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  // A ticket, not the receipt used for billing: these are the codes the salon hands its own
  // customers, and the two must not look alike in a nav that lists both.
  coupons: "M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z",
  whatsapp: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z",
  bot: "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z",
  // A card terminal: this page is about taking money from customers.
  payments: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
  settings: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  // A receipt, not the card terminal above. These two used to share byte-identical artwork, which
  // made "תשלומים וסליקה" and "המנוי שלי" indistinguishable in the More sheet — the same pair whose
  // *names* were confusable until they were renamed. The salon's own invoice is not the salon's
  // customers paying it, and the icons should say so at a glance.
  billing: "M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185zM9.75 9h.008v.008H9.75V9zm4.875 6h.008v.008h-.008V15z",
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
    // Inquiry mode has no add_to_waitlist tool (see bot/claudeBot.ts inquiryTools), so this page
    // can never be anything but empty for an overnight rental.
    { href: "/dashboard/waitlist", key: "waitlist", icon: ICONS.waitlist, hideFor: ["bnb"] },
  ] },
  { titleKey: "business", items: [
    { href: "/dashboard/services", key: "services", icon: ICONS.services },
    { href: "/dashboard/staff", key: "staff", icon: ICONS.staff, hideFor: ["bnb"] },
    { href: "/dashboard/hours", key: "hours", icon: ICONS.hours, hideFor: ["bnb"] },
    { href: "/dashboard/faq", key: "faq", icon: ICONS.faq },
    { href: "/dashboard/coupons", key: "coupons", icon: ICONS.coupons },
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

// Not exported: Next.js allows a layout module to export only its own known names (default,
// metadata, revalidate, …), and any extra export fails `tsc` against the generated .next/types —
// which broke `npm run typecheck` and `next build`. Nothing outside this file uses it.
function isVisibleFor(item: NavItem, businessType: string | null): boolean {
  return !item.hideFor || !businessType || !item.hideFor.includes(businessType);
}

// Curated deliberately rather than taken as the first N of NAV_GROUPS: that ordering is grouped
// for the desktop sidebar, and slicing it happened to hand a prime mobile tab to the waitlist
// while burying everything else. These four are the daily drivers; setup destinations are reached
// via the dock's setup strip (while setup is incomplete) and the More sheet. Four tabs + More also
// leaves noticeably bigger touch targets than five did.
const BOTTOM_TAB_KEYS: NavItem["key"][] = ["analytics", "appointments", "customers", "services"];
const BOTTOM_TAB_ITEMS = BOTTOM_TAB_KEYS
  .map((key) => NAV_ITEMS.find((i) => i.key === key))
  .filter((i): i is NavItem => Boolean(i));
// The mobile grid lists a section's leader, not all of its members: "bot" stands in for the FAQ
// page too, and "settings" for WhatsApp, payments and billing (see lib/sections.ts). That takes the
// sheet from nine tiles to five, and the dropped pages are one tab away once you arrive.
//
// The desktop sidebar deliberately keeps listing every destination. It has room for all seventeen
// rows, and taking working links away from a nav that fits them helps nobody — the sections exist
// to relieve a constraint that only mobile has.
const MORE_ITEMS = NAV_ITEMS.filter(
  (i) => !BOTTOM_TAB_KEYS.includes(i.key) && !SECTION_FOLLOWER_HREFS.has(i.href)
);

/**
 * One destination in the "More" sheet's grid.
 *
 * A tile rather than a list row because nine full-width rows didn't fit the sheet's 70vh cap, so
 * the sheet always scrolled and you could never see all your options at once. Three columns fit
 * the same nine in three rows with room to spare, and the target grows from a 44px-tall row to a
 * 70px square.
 *
 * Labels get two lines: "מחירים ושירותים" and "סליקה וחשבוניות" do not fit one line of a
 * ~105px tile, and truncating the longest names in a menu whose whole job is recognition would
 * defeat the point.
 */
function MoreTile({
  href, icon, label, active, tone = "brand",
}: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
  tone?: "brand" | "admin";
}) {
  const activeBg = tone === "admin" ? "#FEF3C7" : "#DCF1F8";
  const activeFg = tone === "admin" ? "#92400E" : "#136B87";
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="h-[66px] flex flex-col items-center justify-center gap-1 px-1 rounded-xl text-[11px] font-medium leading-tight text-center transition"
      style={{
        background: active ? activeBg : "#F5F7F9",
        color: active ? activeFg : "#374151",
        border: `1px solid ${active ? activeBg : "#EDF1F4"}`,
      }}
    >
      <svg className="w-[22px] h-[22px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.2 : 1.75} d={icon} />
      </svg>
      <span className="line-clamp-2">{label}</span>
    </Link>
  );
}

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
          // Same reasoning as entering: leaving impersonation changes who is signed in, so the
          // whole app has to re-initialise rather than keep the business's data on screen.
          reloadAs(exitImpersonation() ? "/dashboard/admin" : "/login");
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

function SidebarContent({
  pathname, isSuperAdmin, waitlistPending,
}: { pathname: string; isSuperAdmin: boolean; waitlistPending: number }) {
  const router = useRouter();
  const { lang, setLang, t, businessType } = useLanguage();
  const he = lang === "he";

  function logout() {
    clearToken();
    // Full load: router.push leaves the previous account's data in memory, so the next person to
    // sign in on this device can briefly see it before the new fetches land.
    reloadAs("/login");
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
            priority
            className="rounded-xl shrink-0"
            style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}
          />
          <div>
            <div className="font-bold text-base text-white leading-tight tracking-tight">תורי</div>
            <div className="text-[10px] leading-none mt-0.5 font-medium" style={{ color: "rgba(255,255,255,0.25)", letterSpacing: "0.03em" }}>{t.brandTagline}</div>
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
            {group.items.filter((i) => isVisibleFor(i, businessType)).map((item) => {
              const active = pathname === item.href;
              // On desktop the waitlist has its own row, so the count belongs on it rather than on
              // bookings — the mobile dock only borrows the bookings tab because the waitlist has
              // no tab to put it on.
              const badge = item.key === "waitlist" ? waitlistPending : 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={badge > 0 ? `${t.nav[item.key]} — ${badge} ${he ? "ממתינים" : "waiting"}` : undefined}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all"
                  style={navLinkStyle(active)}
                  onMouseEnter={(e) => { if (!active) { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.85)"; } }}
                  onMouseLeave={(e) => { if (!active) { (e.currentTarget as HTMLElement).style.background = ""; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.45)"; } }}
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ opacity: active ? 1 : 0.7 }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.5 : 1.75} d={item.icon} />
                  </svg>
                  <span className="truncate">{t.nav[item.key]}</span>
                  {badge > 0 && (
                    <span
                      className="ms-auto shrink-0 min-w-[20px] h-5 px-1.5 rounded-full flex items-center
                        justify-center text-[11px] font-bold leading-none tabular-nums"
                      style={{ background: "#DC2626", color: "#FFFFFF" }}
                      aria-hidden
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}

        {isSuperAdmin && (
          <div className="flex flex-col gap-0.5">
            <div className="px-3 mb-1">
              <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(232,184,75,0.6)", textTransform: "uppercase" }}>{t.adminSection}</span>
            </div>
            {[
              { href: "/dashboard/admin", label: t.adminSection, icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
              { href: "/dashboard/admin/leads", label: t.leadFinder, icon: "M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" },
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
  const { t, lang, businessType } = useLanguage();
  const he = lang === "he";
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

  // Waitlist entries nobody has replied to yet. The waitlist doesn't get a tab of its own — pricing
  // keeps the fourth slot — so without this the only sign that someone is waiting is behind "More",
  // which an owner has no reason to open on a normal day. Re-fetched on navigation rather than
  // polled: it's a single COUNT, and the moment it changes is the moment you acted on it.
  const [waitlistPending, setWaitlistPending] = useState(0);
  useEffect(() => {
    apiFetch<{ waitlist: number }>("/api/business/me/nav-badges")
      .then((b) => setWaitlistPending(b.waitlist ?? 0))
      .catch(() => {});
  }, [pathname]);

  // The single setup nudge, rendered as a strip inside the dock rather than as a bar of its own.
  const setupStep = useNextSetupStep(lang);

  // How much of the bottom of the screen the dock actually occupies — its own height plus the gap
  // it floats above and the home-indicator inset below that. Published so <main> can reserve it and
  // the More sheet can sit on top of it, neither of which can otherwise know: the dock grows by
  // 34px when the setup strip appears, and by --safe-b on a notched phone.
  //
  // Measured rather than computed from constants. The previous arrangement hard-coded the number in
  // one file and changed the chrome in another, which is exactly how content ended up underneath it.
  const dockRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const publish = () => {
      const el = dockRef.current;
      const rect = el?.getBoundingClientRect();
      // Zero height means `md:hidden` has it display:none — on desktop nothing is occupied, and
      // without this guard the whole viewport height would be reported.
      const occupied = !rect || rect.height === 0 ? 0 : Math.round(window.innerHeight - rect.top);
      root.style.setProperty("--mobile-dock-occupied", `${occupied}px`);
    };
    publish();

    const ro = new ResizeObserver(publish);
    if (dockRef.current) ro.observe(dockRef.current);
    window.addEventListener("resize", publish);
    window.addEventListener("orientationchange", publish);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", publish);
      window.removeEventListener("orientationchange", publish);
    };
  }, [setupStep, businessType, isSuperAdmin]);

  function logout() {
    clearToken();
    // Full load: router.push leaves the previous account's data in memory, so the next person to
    // sign in on this device can briefly see it before the new fetches land.
    reloadAs("/login");
  }

  const moreActive = MORE_ITEMS.some((i) => i.href === pathname) || pathname.startsWith("/dashboard/admin");
  // Escape to close, focus moved in and restored, focus trapped, background scroll locked — the
  // sheet is modal in every way except that it previously behaved like inert markup.
  const moreRef = useDialog<HTMLDivElement>(() => setMoreOpen(false), moreOpen);

  return (
    <AuthGuard>
    {/* Plex overrides the body's Assistant for the whole dashboard subtree — the marketing
        side persuades, this side is a tool, and they are allowed to sound different. */}
    <div className="flex min-h-screen font-[family-name:var(--font-plex)]" style={{ background: "#F4F6F8" }}>
      {/* The sidebar is 17 links deep and comes first in the DOM, so without this a keyboard user
          tabbed through all of it before reaching page content — on every single navigation.
          Visually hidden until focused, which is the point: only keyboard users need it. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-50
          focus:px-4 focus:py-2 focus:rounded-lg focus:bg-white focus:text-[#145F78]
          focus:font-semibold focus:text-sm focus:shadow-lg"
      >
        {t.skipToContent}
      </a>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex w-64 flex-col py-7 px-3 shrink-0 fixed top-0 bottom-0 start-0 z-20"
        style={{
          background: "linear-gradient(180deg, #0B2030 0%, #0D2A38 100%)",
          borderInlineEnd: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "4px 0 24px rgba(0,0,0,0.15)",
        }}
      >
        <SidebarContent pathname={pathname} isSuperAdmin={isSuperAdmin} waitlistPending={waitlistPending} />
      </aside>

      {/* There is deliberately no mobile top bar any more. It was 56px of fixed chrome carrying a
          36px logo and one string — `t.nav[activeItem.key]`, which is the page's own <h1> verbatim,
          printed again about 110px below it. The right ~250px was empty. The page heading names the
          page and the dock shows where you are; there was nothing left for a second bar to say.

          It did incidentally hold content clear of the status bar, so <main> now reserves --safe-t
          itself. */}

      {/* Main content. The bottom padding is the dock's real occupied height (published by the
          effect above) plus breathing room. It used to be a flat `pb-24` (96px) that assumed no
          setup bar, so when one appeared the last ~23px of every page went underneath it — the
          constant lived here while the bar that invalidated it lived in another file. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 md:ms-64 px-4 pt-[calc(1rem+var(--safe-t))]
          pb-[calc(var(--mobile-dock-occupied)+1rem)]
          md:p-8 md:pt-8 md:pb-8 overflow-auto"
      >
        <ImpersonationBanner />
        <TrialBanner status={trial?.status ?? null} createdAt={trial?.createdAt ?? null} />
        {/* Renders only on pages that have siblings; null everywhere else. Placed here rather than
            inside each member page so a section added later can't ship without its tabs. */}
        <SectionTabs />
        {children}
      </main>

      {/* The mobile nav dock: one floating card, holding the optional setup strip and the tabs.
          Floating rather than edge-to-edge because a bar welded to the bottom of the screen reads
          as part of the device; lifted onto the page with a shadow, it reads as part of the app.
          It is opaque, not translucent — content sliding under a floating card looks like a
          rendering fault, whereas content sliding under a screen-wide bar looks intentional.

          The setup prompt lives *inside* it. It used to be a second fixed bar of its own, 55px
          stacked on the tab bar at the same z-index, so which drew on top came down to DOM order.
          As a 34px strip sharing this card there is one piece of chrome and nothing to stack. */}
      <div
        ref={dockRef}
        className="md:hidden fixed z-30 rounded-2xl overflow-hidden
          bottom-[calc(0.625rem+var(--safe-b))]
          left-[calc(0.75rem+var(--safe-l))] right-[calc(0.75rem+var(--safe-r))]"
        style={{
          background: "#FFFFFF",
          border: "1px solid #E6ECF1",
          boxShadow: "0 6px 24px rgba(15,29,42,0.14), 0 2px 6px rgba(15,29,42,0.08)",
        }}
      >
        {setupStep && (
          <Link
            href={setupStep.href}
            className="flex items-center gap-2 px-3 h-[34px] border-b"
            style={{
              background: setupStep.critical ? "#FFFBEB" : "#F3F7FA",
              borderColor: setupStep.critical ? "#FDE68A" : "#E8EEF3",
            }}
          >
            {/* One number, not two. A circular "6" badge next to a "6/6" counter said the same
                thing twice on a 34px strip, and "6" alone read as "six done" rather than "step
                six". The fraction carries both the position and the progress. */}
            <span
              className="shrink-0 px-1.5 py-0.5 rounded-md text-[11px] font-bold tabular-nums"
              style={{
                background: setupStep.critical ? "#FDE68A" : "#DCF1F8",
                color: setupStep.critical ? "#78350F" : "#136B87",
              }}
            >
              {setupStep.stepNumber}/{setupStep.totalCount}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold" style={{ color: "#0F1D2A" }}>
              {setupStep.label}
            </span>
            <span className="shrink-0 text-base leading-none" style={{ color: "#1B7FA0" }} aria-hidden>
              {he ? "←" : "→"}
            </span>
          </Link>
        )}

        <nav className="flex items-stretch h-[60px]" aria-label={he ? "ניווט ראשי" : "Main navigation"}>
          {BOTTOM_TAB_ITEMS.filter((i) => isVisibleFor(i, businessType)).map((item) => {
            const active = pathname === item.href;
            // The waitlist has no tab of its own, so its badge rides on the bookings tab — the
            // screen an owner is already going to, and the one whose page links onward to the list.
            const badge = item.key === "appointments" ? waitlistPending : 0;
            const label = (t.navShort as Record<string, string>)[item.key] ?? t.nav[item.key];
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                // The count is decoration to a screen reader unless it's spelled out: "3" next to
                // "Bookings" announces as "3 Bookings", which is not what it means.
                aria-label={badge > 0 ? `${label} — ${badge} ${he ? "ממתינים ברשימת ההמתנה" : "waiting on the waitlist"}` : undefined}
                className="flex-1 flex flex-col items-center justify-center gap-[3px] text-[11px] font-medium transition"
                style={{ color: active ? "#136B87" : "#6B7280" }}
              >
                {/* A tinted pill, not just a colour swap. The old active state was hue alone
                    (#1B7FA0 against #6B7280) plus a stroke-width change, which is invisible to a
                    red-green colour-blind user and nearly invisible to everyone in sunlight. */}
                <span
                  className="relative flex items-center justify-center w-11 h-7 rounded-full transition"
                  style={{ background: active ? "#DCF1F8" : "transparent" }}
                >
                  <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.2 : 1.75} d={item.icon} />
                  </svg>
                  {badge > 0 && (
                    // Physical right/left, not end/start: the badge hangs off the icon's top-right
                    // corner in both languages, because that is where a notification count lives by
                    // convention — it is not part of the text flow and shouldn't mirror with it.
                    <span
                      className="absolute -top-0.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full
                        flex items-center justify-center text-[10px] font-bold leading-none tabular-nums"
                      style={{ background: "#B91C1C", color: "#FFFFFF", boxShadow: "0 0 0 2px #FFFFFF" }}
                      aria-hidden
                    >
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </span>
                <span className="truncate max-w-[68px] text-center leading-tight">{label}</span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            className="flex-1 flex flex-col items-center justify-center gap-[3px] text-[11px] font-medium transition"
            style={{ color: moreOpen || moreActive ? "#136B87" : "#6B7280" }}
          >
            <span
              className="flex items-center justify-center w-11 h-7 rounded-full transition"
              style={{ background: moreOpen || moreActive ? "#DCF1F8" : "transparent" }}
            >
              <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={moreOpen || moreActive ? 2.2 : 1.75} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </span>
            <span>{he ? "עוד" : "More"}</span>
          </button>
        </nav>
      </div>

      {/* "More" sheet — the nine destinations that don't fit the four tabs.

          This was a scrolling list of nine full-width rows, about 618px of content against a 591px
          cap, so it always scrolled: you opened it, saw six items, and had to drag to find out
          whether the seventh was the one you wanted. That — not the bar — is what made "עוד" hard
          to navigate.

          As a three-column grid the same nine fit in three rows with everything visible at once,
          the group headings survive, and each target grows from a 44px-tall row to a 70px tile.
          It floats above the dock and shares its horizontal insets, so the two read as one system. */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            ref={moreRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="more-sheet-title"
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-[calc(var(--mobile-dock-occupied)+0.5rem)]
              left-[calc(0.75rem+var(--safe-l))] right-[calc(0.75rem+var(--safe-r))]
              bg-white rounded-2xl shadow-2xl p-3 max-h-[70vh] overflow-y-auto"
          >
            {/* Sticky header: the sheet scrolls, and without this the only way out (other than
                tapping the dim backdrop, which isn't obvious) scrolled away with the content. */}
            <div className="sticky top-0 -mx-3 -mt-3 mb-1 px-3 pt-3 pb-2 bg-white flex items-center justify-between gap-2 border-b border-gray-100">
              <h2 id="more-sheet-title" className="text-sm font-bold text-gray-900">{he ? "כל הדפים" : "All pages"}</h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label={he ? "סגירה" : "Close"}
                className="row-action -me-1 px-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Mirror the sidebar's grouping so the sheet reads as sections, not 9 flat siblings */}
            {NAV_GROUPS.map((group) => {
              const items = group.items.filter((i) => MORE_ITEMS.includes(i) && isVisibleFor(i, businessType));
              if (items.length === 0) return null;
              return (
                <div key={group.titleKey}>
                  <div className="px-1 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
                    {t.navGroups[group.titleKey]}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {items.map((item) => (
                      <MoreTile
                        key={item.href}
                        href={item.href}
                        icon={item.icon}
                        label={t.nav[item.key]}
                        active={pathname === item.href}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            {isSuperAdmin && (
              <div>
                <div className="px-1 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
                  {t.adminSection}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <MoreTile
                    href="/dashboard/admin"
                    icon="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    label={t.adminSection}
                    active={pathname === "/dashboard/admin"}
                    tone="admin"
                  />
                  <MoreTile
                    href="/dashboard/admin/leads"
                    icon="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
                    label={t.leadFinder}
                    active={pathname === "/dashboard/admin/leads"}
                    tone="admin"
                  />
                </div>
              </div>
            )}
            <button
              onClick={logout}
              className="mt-2.5 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-gray-600 border border-gray-200 transition"
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
