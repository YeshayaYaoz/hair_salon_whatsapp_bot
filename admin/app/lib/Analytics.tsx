"use client";

import Script from "next/script";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Google Analytics 4 and the Meta pixel, each loaded only when its id is configured.
 *
 * The site had no measurement at all: no way to tell whether a visit came from an ad, a video or
 * a referral, and no way to tell which of those turned into a signup. Both tags are the standard
 * snippets, gated on NEXT_PUBLIC_GA_MEASUREMENT_ID and NEXT_PUBLIC_META_PIXEL_ID so a deployment
 * without them ships nothing — no request, no cookie.
 *
 * The dashboard is excluded: it is the owners' own workspace, not a marketing surface, and the
 * numbers of interest are visitors and signups, which both happen before it.
 *
 * `trackSignup()` is the one conversion event, fired from the signup form on success.
 */
const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() ?? "";
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() ?? "";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
  }
}

export function trackSignup(): void {
  try {
    window.gtag?.("event", "sign_up", { method: "email" });
    window.fbq?.("track", "CompleteRegistration");
  } catch {
    /* analytics must never break the signup it measures */
  }
}

export default function Analytics() {
  const pathname = usePathname();
  const inDashboard = pathname?.startsWith("/dashboard") ?? false;

  // GA4 counts the first page view itself; later client-side navigations are reported here.
  useEffect(() => {
    if (!GA_ID || inDashboard || !pathname) return;
    window.gtag?.("event", "page_view", { page_path: pathname });
  }, [pathname, inDashboard]);

  if (inDashboard || (!GA_ID && !PIXEL_ID)) return null;

  return (
    <>
      {GA_ID && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${GA_ID}',{send_page_view:true});`}
          </Script>
        </>
      )}
      {PIXEL_ID && (
        <Script id="meta-pixel-init" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${PIXEL_ID}');fbq('track','PageView');`}
        </Script>
      )}
    </>
  );
}
