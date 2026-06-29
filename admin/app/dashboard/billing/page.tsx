"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

export default function BillingPage() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ subscriptionStatus: string }>("/api/business/me").then((me) => setStatus(me.subscriptionStatus));
  }, []);

  async function subscribe() {
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ returnUrl: window.location.href }),
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
    }
  }

  return (
    <main>
      <h2>Billing</h2>
      <p>
        Subscription status: <strong>{status ?? "loading..."}</strong>
      </p>
      {status !== "active" && (
        <button onClick={subscribe}>{status === "trial" ? "Subscribe now" : "Reactivate subscription"}</button>
      )}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </main>
  );
}
