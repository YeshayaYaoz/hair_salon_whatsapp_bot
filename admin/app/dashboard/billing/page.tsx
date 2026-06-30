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
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ subscriptionStatus: string; whatsappConnected: boolean }>("/api/business/me").then((me) => {
      setStatus(me.subscriptionStatus);
      setWhatsappConnected(me.whatsappConnected);
    });
  }, []);

  async function subscribe() {
    setError(null);
    setCheckoutLoading(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ returnUrl: window.location.href }),
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function openPortal() {
    setError(null);
    setPortalLoading(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/billing/portal", {
        method: "POST",
        body: JSON.stringify({ returnUrl: window.location.href }),
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing portal");
    } finally {
      setPortalLoading(false);
    }
  }

  const info = status ? STATUS_INFO[status] : null;

  return (
    <div className="max-w-md">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Billing</h1>
        <p className="text-zinc-400 text-sm mt-1">Manage your subscription</p>
      </div>

      {!whatsappConnected && status !== null && (
        <div className="bg-yellow-950/30 border border-yellow-800 text-yellow-400 text-sm rounded-xl px-4 py-3 mb-4">
          Connect your WhatsApp number before subscribing — the bot won't go live without it.
        </div>
      )}

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

            <div className="flex flex-col gap-2">
              {status !== "active" && (
                <button
                  onClick={subscribe}
                  disabled={checkoutLoading}
                  className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition"
                >
                  {checkoutLoading ? "Redirecting..." : status === "trial" ? "Subscribe now" : "Reactivate subscription"}
                </button>
              )}

              {(status === "active" || status === "past_due") && (
                <button
                  onClick={openPortal}
                  disabled={portalLoading}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-100 text-sm font-semibold py-2.5 rounded-lg transition"
                >
                  {portalLoading ? "Redirecting..." : "Manage billing & invoices"}
                </button>
              )}
            </div>

            {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
