import type { ReactNode } from "react";
import type { Metadata } from "next";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Booking pages are the one surface a salon actually distributes: it goes in their Instagram bio,
 * their WhatsApp status, their Google Business Profile. Every one of those renders a link preview
 * from the page's metadata — and because `page.tsx` is a client component with no metadata of its
 * own, all of them inherited the root layout's marketing title. A salon sharing its booking link
 * was advertising "תורי | בוט WhatsApp AI לקביעת תורים אוטומטית" instead of its own name, which is
 * both a worse preview for them and a strange one for their customer, who has never heard of us.
 *
 * This layout exists solely to resolve the salon's real name server-side and hand it to the
 * preview. It renders nothing of its own.
 *
 * `robots: noindex` is deliberate and matches robots.txt, which already disallows /book/. These
 * pages carry no unique content beyond a name and a service list, and thousands of them would read
 * to a crawler as doorway pages. Note that noindex does not suppress link previews: WhatsApp,
 * Instagram and Facebook read Open Graph tags regardless, which is exactly the case this serves.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ businessId: string }>;
}): Promise<Metadata> {
  const { businessId } = await params;

  let name: string | null = null;
  let address: string | undefined;
  try {
    // A booking page must render even when this call fails, so a failure here degrades to the
    // generic title rather than throwing and taking the route down with it.
    const res = await fetch(`${API}/api/public/${businessId}`, {
      // The salon's name and address change rarely; an hour of caching keeps a shared link from
      // hitting the API once per preview-scrape while still picking up a rename the same day.
      next: { revalidate: 3600 },
    });
    if (res.ok) {
      const data = (await res.json()) as { name?: string; address?: string };
      if (typeof data.name === "string" && data.name.trim()) name = data.name.trim();
      if (typeof data.address === "string" && data.address.trim()) address = data.address.trim();
    }
  } catch {
    // Fall through to the generic metadata below.
  }

  if (!name) {
    return {
      title: "קביעת תור",
      description: "קביעת תור אונליין — בחירת שירות, תאריך ושעה בכמה קליקים.",
      robots: { index: false, follow: false },
    };
  }

  const title = `קביעת תור — ${name}`;
  const description = address
    ? `קביעת תור אונליין ל${name}, ${address}. בוחרים שירות, תאריך ושעה — ומקבלים אישור מיד.`
    : `קביעת תור אונליין ל${name}. בוחרים שירות, תאריך ושעה — ומקבלים אישור מיד.`;

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      locale: "he_IL",
      title,
      description,
      siteName: name,
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default function BookLayout({ children }: { children: ReactNode }) {
  return children;
}
