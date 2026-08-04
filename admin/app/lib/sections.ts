/**
 * Destinations that belong together closely enough to be reached as tabs of one another.
 *
 * The mobile "More" sheet held nine destinations. Nine fit on one screen as a grid, but nine is
 * still a lot to keep in your head, and two clusters in it were only separate pages for historical
 * reasons: "the bot" and "FAQ" are both *what the bot knows and says*, and WhatsApp / payments /
 * settings / billing are four configure-once account screens nobody visits twice in a week.
 *
 * Grouping them into two sections takes More from nine tiles to five.
 *
 * Deliberately NOT a route restructure. Every URL below still exists and still renders its own
 * page — bookmarks, the setup checklist's deep links, and the desktop sidebar all keep working
 * untouched. The only thing that changes is that each page also shows its siblings as tabs, and
 * that the mobile grid lists the section leader instead of every member.
 *
 * This module exists separately from dashboard/layout.tsx because Next.js only lets a layout module
 * export its own known names (default, metadata, …); an extra export there fails the build against
 * the generated .next/types.
 */

export type SectionMember = {
  href: string;
  /** Key into `t.nav`, so tab labels stay identical to the nav labels they replace. */
  navKey: string;
};

export type Section = {
  /** The member the mobile More grid points at, and the tab shown first. */
  leaderHref: string;
  members: SectionMember[];
};

export const SECTIONS: Section[] = [
  {
    leaderHref: "/dashboard/bot",
    members: [
      { href: "/dashboard/bot", navKey: "bot" },
      { href: "/dashboard/faq", navKey: "faq" },
    ],
  },
  {
    // Settings leads rather than WhatsApp: it is the name people look for when they want to change
    // something about the account. WhatsApp stays directly reachable regardless — the setup strip
    // links to it by href for as long as setup is incomplete, which is when it actually matters.
    leaderHref: "/dashboard/settings",
    members: [
      { href: "/dashboard/settings", navKey: "settings" },
      { href: "/dashboard/whatsapp", navKey: "whatsapp" },
      { href: "/dashboard/payments", navKey: "payments" },
      { href: "/dashboard/billing", navKey: "billing" },
    ],
  },
];

export function sectionFor(pathname: string): Section | undefined {
  return SECTIONS.find((s) => s.members.some((m) => m.href === pathname));
}

/**
 * Members that aren't their section's leader — the ones the mobile More grid drops, because their
 * leader carries them. Desktop keeps listing all of them; see the sidebar in dashboard/layout.tsx.
 */
export const SECTION_FOLLOWER_HREFS: ReadonlySet<string> = new Set(
  SECTIONS.flatMap((s) => s.members.filter((m) => m.href !== s.leaderHref).map((m) => m.href))
);
