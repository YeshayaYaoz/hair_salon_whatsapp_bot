"use client";

import { useEffect } from "react";
import Image from "next/image";
import { reportClientError } from "./lib/sentry";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Dashboard error boundary caught:", error);
    reportClientError(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#F4F6F8] flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <Image src="/tori_logo_transparent.png" alt="תורי" width={56} height={56} className="mx-auto mb-6 rounded-2xl" />
        <div className="text-4xl mb-3">⚠️</div>
        <h1 className="text-lg font-bold text-gray-900 mb-2">משהו השתבש</h1>
        <p className="text-sm text-gray-500 mb-8 leading-relaxed">
          אירעה שגיאה בלתי צפויה. ניסינו לתעד אותה אצלנו — נסה לרענן את הדף.
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 bg-[#1B7FA0] hover:bg-[#2A9BBF] text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
        >
          נסה שוב
        </button>
      </div>
    </div>
  );
}
