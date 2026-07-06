"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Merged into the Schedule tab (hours + time off) — keep this route alive as a redirect
// for anyone with the old link bookmarked.
export default function BlockedTimesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/hours");
  }, [router]);
  return null;
}
