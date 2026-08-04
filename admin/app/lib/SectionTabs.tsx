"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "./LanguageContext";
import { sectionFor } from "./sections";

/**
 * The sibling switcher for pages that belong to a section (see sections.ts). Renders nothing
 * anywhere else, which is most of the dashboard.
 *
 * Rendered once by the dashboard layout rather than added to each of the six member pages: one
 * placement that can't drift, and no way to add a section member later and forget its tabs.
 *
 * It scrolls horizontally rather than wrapping. The settings section has four tabs whose Hebrew
 * labels total wider than a 390px phone, and a control that silently reflows to two rows stops
 * reading as one row of choices.
 */
export function SectionTabs() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const section = sectionFor(pathname);

  if (!section) return null;

  return (
    <nav
      aria-label={t.sectionTabsLabel}
      // -mx-4/px-4 on mobile so the row bleeds to the screen edge as it scrolls, instead of
      // stopping short of it and looking clipped. `no-scrollbar` isn't used: on the platforms that
      // show a persistent scrollbar it is the only affordance saying there is more to the side.
      className="mb-5 -mx-4 px-4 md:mx-0 md:px-0 overflow-x-auto"
    >
      <div className="inline-flex gap-1 p-1 rounded-xl" style={{ background: "#EAEFF3" }}>
        {section.members.map((m) => {
          const active = pathname === m.href;
          return (
            <Link
              key={m.href}
              href={m.href}
              aria-current={active ? "page" : undefined}
              className="whitespace-nowrap px-3.5 py-2 rounded-lg text-[13px] font-semibold transition"
              style={
                active
                  ? { background: "#FFFFFF", color: "#136B87", boxShadow: "0 1px 2px rgba(15,29,42,0.10)" }
                  : { color: "#4B5563" }
              }
            >
              {(t.nav as Record<string, string>)[m.navKey]}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
