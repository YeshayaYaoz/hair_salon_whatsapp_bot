"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

const STATUS_INFO: Record<string, { label: string; color: string; description: string }> = {
  trial: { label: "Trial", color: "bg-yellow-950/50 text-yellow-400 border-yellow-800", description: "You're on a free trial. Subscribe to keep the bot running." },
  active: { label: "Active", color: "bg-green-950/50 text-green-400 border-green-800", description: "Your subscription is active. The bot is live." },
  past_due: { label: "Past due", color: "bg-red-950/50 text-red-400 border-red-800", description: "Payment failed. Update your payment method to restore access." },
  canceled: { label: "Canceled", color: "bg-zinc-800 text-zinc-400 border-zinc-700", description: "Your subscription has been canceled." },
};

export default function BillingPage() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ subscriptionStatus: string }>("/api/business/me").then((me) => setStatus(me.subscriptionStatus));
  }, []);

  async function subscribe() {
    setError(null);
    setLoading(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ returnUrl: window.location.href }),
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
    } finally {
      setLoading(false);
    }
  }

  const info = status ? STATUS_INFO[status] : null;

  return (
    <div className="max-w-md">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Billing</h1>
        <p className="text-zinc-400 text-sm mt-1">Manage your subscription</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        {status === null ? (
          <p className="text-zinc-500 text-sm">Loading...</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-zinc-400">Subscription status</span>
              {info && (
                <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full border ${info.color}`}>
                  {info.label}
                </span>
              )}
            </div>

            <p className="text-sm text-zinc-400 mb-5">{info?.description}</p>

            {status !== "active" && (
              <button
                onClick={subscribe}
                disabled={loading}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition"
              >
                {loading ? "Redirecting..." : status === "trial" ? "Subscribe now" : "Reactivate subscription"}
              </button>
            )}

            {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
