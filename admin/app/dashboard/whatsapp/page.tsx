"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

export default function WhatsAppPage() {
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch<{ whatsappConnected: boolean }>("/api/business/me").then((me) => setConnected(me.whatsappConnected));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await apiFetch("/api/business/me/whatsapp", { method: "PUT", body: JSON.stringify({ phoneNumberId, accessToken }) });
    setSaved(true);
    setConnected(true);
  }

  return (
    <main>
      <h2>WhatsApp Connection</h2>
      <p>
        Status: <strong>{connected ? "Connected" : "Not connected"}</strong>
      </p>
      <p>
        Get these values from your Meta Business app under WhatsApp &gt; API Setup: the <code>Phone number ID</code>{" "}
        and a permanent <code>Access token</code>.
      </p>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 480 }}>
        <input
          placeholder="Phone number ID"
          value={phoneNumberId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          required
        />
        <input
          placeholder="Access token"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          required
        />
        <button type="submit">Save</button>
        {saved && <span style={{ color: "green" }}>Saved</span>}
      </form>
    </main>
  );
}
