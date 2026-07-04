"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";

interface Customer {
  id: string;
  name?: string;
  phone: string;
  _count: { appointments: number };
}

function MessageModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { t } = useLanguage();
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    try {
      await apiFetch(`/api/business/customers/${customer.id}/message`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      setState("sent");
      setTimeout(onClose, 1500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to send");
      setState("error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{t.sendMessage}</h2>
            <p className="text-xs text-gray-400">{customer.name ?? customer.phone}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {state === "sent" ? (
          <div className="flex items-center gap-2 text-green-600 text-sm py-3 justify-center">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {t.messageSent}
          </div>
        ) : (
          <form onSubmit={send} className="flex flex-col gap-3">
            <textarea
              rows={3}
              placeholder={t.messagePlaceholder}
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
              className="w-full"
            />
            {state === "error" && <p className="text-red-600 text-xs">{errorMsg}</p>}
            <button
              type="submit"
              disabled={state === "sending"}
              className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition"
            >
              {state === "sending" ? t.sending : t.send}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function CustomersPage() {
  const { t } = useLanguage();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [messaging, setMessaging] = useState<Customer | null>(null);

  useEffect(() => {
    apiFetch<Customer[]>("/api/business/customers").then(setCustomers);
  }, []);

  const filtered = customers.filter(
    (c) =>
      c.phone.includes(search) ||
      (c.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="animate-fade-in">
      {messaging && <MessageModal customer={messaging} onClose={() => setMessaging(null)} />}

      <div className="mb-6 flex items-center justify-between flex-wrap gap-3 animate-fade-up">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.customersTitle}</h1>
          <p className="text-gray-500 text-sm mt-1">{customers.length} {t.totalCustomers}</p>
        </div>
        <input
          placeholder={t.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden animate-fade-up stagger-2">
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400 text-sm">
            {t.noCustomers}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-start px-4 py-3 text-gray-500 font-medium">{t.customer}</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">{t.when}</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium text-end">{t.totalBookings}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={c.id} className={i !== filtered.length - 1 ? "border-b border-gray-200/50" : ""}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#1B7FA0]/20 border border-[#145F78]/40 flex items-center justify-center text-[#5BB8D4] font-semibold text-sm shrink-0">
                        {(c.name ?? c.phone).charAt(0).toUpperCase()}
                      </div>
                      <span className="text-gray-700 font-medium">{c.name ?? <span className="text-gray-400 italic">—</span>}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{c.phone}</td>
                  <td className="px-4 py-3 text-end">
                    <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                      {c._count.appointments}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-end">
                    <button
                      onClick={() => setMessaging(c)}
                      className="text-xs text-gray-400 hover:text-[#1B7FA0] transition border border-gray-200 hover:border-[#8DD4E8] px-3 py-1.5 rounded-lg"
                    >
                      {t.sendMessage}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
