"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";

interface Customer {
  id: string;
  name?: string;
  phone: string;
  _count: { appointments: number };
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

function ConversationPanel({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { t, lang } = useLanguage();
  const he = lang === "he";
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true);
    try {
      setMessages(await apiFetch<Message[]>(`/api/business/conversations/${encodeURIComponent(customer.phone)}`));
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer.phone]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      await apiFetch(`/api/business/customers/${customer.id}/message`, {
        method: "POST",
        body: JSON.stringify({ text: body }),
      });
      setText("");
      // Optimistically show it, then reconcile with the server-side transcript shortly after.
      setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: "assistant", content: body, createdAt: new Date().toISOString() }]);
      setTimeout(load, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleString(he ? "he-IL" : "en-US", { timeZone: "Asia/Jerusalem", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-white w-full max-w-md h-full flex flex-col shadow-2xl animate-fade-in"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-[#1B7FA0]/20 border border-[#145F78]/40 flex items-center justify-center text-[#5BB8D4] font-semibold text-sm shrink-0">
              {(customer.name ?? customer.phone).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">{customer.name ?? customer.phone}</div>
              <div className="text-xs text-gray-400 font-mono">{customer.phone}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 bg-gray-50/60">
          {loading ? (
            <p className="text-gray-400 text-sm text-center py-10">{he ? "טוען…" : "Loading…"}</p>
          ) : messages.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-10">{he ? "עדיין אין הודעות עם לקוח זה" : "No messages with this customer yet"}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-[#DCF8C6] self-end rounded-br-sm text-gray-900"
                      : "bg-white border border-gray-200 self-start rounded-bl-sm text-gray-800"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  <span className="block text-[10px] text-gray-400 mt-1">{fmtDate(m.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={send} className="border-t border-gray-100 p-3 flex items-end gap-2 shrink-0">
          <textarea
            rows={1}
            placeholder={t.messagePlaceholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex-1 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); }
            }}
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition shrink-0"
          >
            {sending ? "…" : t.send}
          </button>
        </form>
        {error && <p className="text-red-600 text-xs px-4 pb-3">{error}</p>}
      </div>
    </div>
  );
}

export default function CustomersPage() {
  const { t } = useLanguage();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Customer | null>(null);

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
      {open && <ConversationPanel customer={open} onClose={() => setOpen(null)} />}

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
                <tr
                  key={c.id}
                  onClick={() => setOpen(c)}
                  className={`cursor-pointer hover:bg-gray-50 transition ${i !== filtered.length - 1 ? "border-b border-gray-200/50" : ""}`}
                >
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
                      onClick={(e) => { e.stopPropagation(); setOpen(c); }}
                      className="text-xs text-gray-400 hover:text-[#1B7FA0] transition border border-gray-200 hover:border-[#8DD4E8] px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.9 9.9 0 01-4.29-.98L3 20l1.3-3.9C3.47 15.03 3 13.57 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
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
