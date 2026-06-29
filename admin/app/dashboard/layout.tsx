"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { clearToken } from "../lib/api";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();

  function logout() {
    clearToken();
    router.push("/");
  }

  return (
    <div>
      <nav style={{ display: "flex", gap: 16, marginBottom: 24, borderBottom: "1px solid #ddd", paddingBottom: 12 }}>
        <Link href="/dashboard/services">Services</Link>
        <Link href="/dashboard/hours">Hours</Link>
        <Link href="/dashboard/whatsapp">WhatsApp</Link>
        <Link href="/dashboard/appointments">Appointments</Link>
        <Link href="/dashboard/billing">Billing</Link>
        <button onClick={logout} style={{ marginLeft: "auto" }}>
          Log out
        </button>
      </nav>
      {children}
    </div>
  );
}
