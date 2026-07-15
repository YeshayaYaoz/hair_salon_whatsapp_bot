"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SkeletonBlock, SkeletonRow } from "../../lib/Skeleton";
import { EmptyState } from "../../lib/EmptyState";
import { formatPhone } from "../../lib/formatPhone";

// Short, stable, human-recognizable reference for a customer (there's no business-facing
// numeric id in the system) — derived from the DB id so it never changes.
function customerDisplayId(id: string): string {
  return `#${id.slice(-6).toUpperCase()}`;
}

interface Customer {
  id: string;
  name?: string;
  phone: string;
  notes?: string | null;
  botPaused?: boolean;
  _count: { appointments: number };
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

function ConversationPanel({
  customer, onClose, onNotesSaved, onPausedChanged,
}: {
  customer: Customer; onClose: () => void; onNotesSaved: (notes: string) => void; onPausedChanged: (paused: boolean) => void;
}) {
  const { t, lang } = useLanguage();
  const he = lang === "he";
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const notesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [botPaused, setBotPaused] = useState(Boolean(customer.botPaused));
  const [togglingPause, setTogglingPause] = useState(false);

  async function toggleBotPaused(paused: boolean) {
    setTogglingPause(true);
    try {
      await apiFetch(`/api/business/customers/${customer.id}/bot-paused`, {
        method: "PATCH",
        body: JSON.stringify({ paused }),
      });
      setBotPaused(paused);
      onPausedChanged(paused);
    } catch {
      // best-effort — button stays clickable to retry
    } finally {
      setTogglingPause(false);
    }
  }

  function scheduleNotesSave(value: string) {
    setNotes(value);
    if (notesSaveTimer.current) clearTimeout(notesSaveTimer.current);
    notesSaveTimer.current = setTimeout(async () => {
      setSavingNotes(true);
      try {
        await apiFetch(`/api/business/customers/${customer.id}/notes`, {
          method: "PATCH",
          body: JSON.stringify({ notes: value }),
        });
        onNotesSaved(value);
      } catch {
        // best-effort — the note stays in the textarea either way, retry happens on next edit
      } finally {
        setSavingNotes(false);
      }
    }, 800);
  }

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
      // Sending a manual message auto-pauses the bot on this thread (see backend) — reflect that
      // immediately rather than waiting on a round trip.
      if (!botPaused) { setBotPaused(true); onPausedChanged(true); }
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
              <div className="text-sm font-semibold text-gray-900 truncate">{customer.name ?? formatPhone(customer.phone)}</div>
              <div className="text-xs text-gray-400 font-mono" dir="ltr">{formatPhone(customer.phone)}</div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!botPaused && (
              <button
                onClick={() => toggleBotPaused(true)}
                disabled={togglingPause}
                title={he ? "השתק בוט לשיחה זו" : "Mute the bot on this thread"}
                className="text-xs font-medium text-gray-400 hover:text-amber-700 hover:bg-amber-50 disabled:opacity-50 px-2 py-1.5 rounded-lg transition"
              >
                {he ? "השתקת בוט" : "Mute bot"}
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {botPaused && (
          <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-amber-200 shrink-0 bg-amber-50">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm shrink-0">🙋</span>
              <span className="text-xs font-semibold text-amber-800 truncate">
                {he ? "השיחה בניהול ידני — הבוט לא עונה" : "You're handling this thread — the bot is silent"}
              </span>
            </div>
            <button
              onClick={() => toggleBotPaused(false)}
              disabled={togglingPause}
              className="shrink-0 text-xs font-semibold text-amber-800 bg-white hover:bg-amber-100 disabled:opacity-50 border border-amber-300 px-2.5 py-1 rounded-lg transition"
            >
              {togglingPause ? "…" : (he ? "החזר לבוט" : "Resume bot")}
            </button>
          </div>
        )}

        <div className="px-5 py-3 border-b border-gray-100 shrink-0 bg-amber-50/40">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-gray-500">{he ? "הערה על הלקוח" : "Customer note"}</label>
            {savingNotes && <span className="text-[10px] text-gray-400">{he ? "שומר…" : "Saving…"}</span>}
          </div>
          <textarea
            rows={2}
            placeholder={he ? "הערה פנימית — לא נראית ללקוח…" : "Internal note — not visible to the customer…"}
            value={notes}
            onChange={(e) => scheduleNotesSave(e.target.value)}
            className="w-full text-sm resize-none bg-white"
          />
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 bg-gray-50/60">
          {loading ? (
            <div className="flex flex-col gap-2">
              <SkeletonBlock className="h-10 w-2/3 self-start rounded-2xl" />
              <SkeletonBlock className="h-8 w-1/2 self-end rounded-2xl" />
              <SkeletonBlock className="h-10 w-3/5 self-start rounded-2xl" />
            </div>
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

function BulkMessageModal({ customers, onClose, onSent }: { customers: Customer[]; onClose: () => void; onSent: () => void }) {
  const { t, lang } = useLanguage();
  const he = lang === "he";
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    setProgress(0);
    try {
      for (const c of customers) {
        await apiFetch(`/api/business/customers/${c.id}/message`, { method: "POST", body: JSON.stringify({ text: body }) });
        setProgress((p) => p + 1);
        await new Promise((r) => setTimeout(r, 400)); // pace sends rather than firing all at once
      }
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{he ? "הודעה קבוצתית" : "Bulk message"}</h2>
            <p className="text-xs text-gray-400">{he ? `אל ${customers.length} לקוחות` : `To ${customers.length} customers`}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={send} className="flex flex-col gap-3">
          <textarea
            rows={3}
            placeholder={t.messagePlaceholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            required
            disabled={sending}
            className="w-full"
          />
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={sending}
            className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition"
          >
            {sending ? `${progress}/${customers.length}...` : (he ? `שלח ל-${customers.length} לקוחות` : `Send to ${customers.length} customers`)}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function CustomersPage() {
  const { t, lang } = useLanguage();
  const he = lang === "he";
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Customer | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);

  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    apiFetch<Customer[]>("/api/business/customers").then((c) => { setCustomers(c); setLoaded(true); });
  }, []);

  const filtered = customers.filter(
    (c) =>
      c.phone.includes(search) ||
      (c.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    setSelected(new Set());
  }, [search]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map((c) => c.id))
    );
  }

  const selectedCustomers = customers.filter((c) => selected.has(c.id));

  return (
    <div className="animate-fade-in">
      {open && (
        <ConversationPanel
          customer={open}
          onClose={() => setOpen(null)}
          onNotesSaved={(notes) => {
            setCustomers((prev) => prev.map((c) => (c.id === open.id ? { ...c, notes } : c)));
            setOpen((prev) => (prev ? { ...prev, notes } : prev));
          }}
          onPausedChanged={(botPaused) => {
            setCustomers((prev) => prev.map((c) => (c.id === open.id ? { ...c, botPaused } : c)));
            setOpen((prev) => (prev ? { ...prev, botPaused } : prev));
          }}
        />
      )}
      {showBulkModal && (
        <BulkMessageModal
          customers={selectedCustomers}
          onClose={() => setShowBulkModal(false)}
          onSent={() => { setShowBulkModal(false); setSelected(new Set()); }}
        />
      )}

      <div className="mb-4 flex items-center justify-between flex-wrap gap-3 animate-fade-up">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.customersTitle}</h1>
          <p className="text-gray-500 text-sm mt-1">{customers.length} {t.totalCustomers}</p>
        </div>
        <div className="flex items-center gap-3">
          {selected.size > 0 && (
            <button
              onClick={() => setShowBulkModal(true)}
              className="bg-[#1B7FA0] hover:bg-[#2A9BBF] text-white text-xs font-semibold px-3 py-2 rounded-lg transition ms-auto"
            >
              {he ? `שלח הודעה ל-${selected.size} נבחרים` : `Message ${selected.size} selected`}
            </button>
          )}
          <input
            placeholder={t.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
        </div>
      </div>

      <div className="flex items-center gap-2.5 mb-4 px-4 py-2.5 rounded-lg bg-[#1B7FA0]/8 border border-[#1B7FA0]/20 animate-fade-up stagger-1">
        <svg className="w-4 h-4 text-[#1B7FA0] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.9 9.9 0 01-4.29-.98L3 20l1.3-3.9C3.47 15.03 3 13.57 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <p className="text-xs text-[#145F78] font-medium">{t.customersHint}</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden animate-fade-up stagger-2">
        {!loaded ? (
          <div>
            {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={3} />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="🤝"
            title={t.noCustomers}
            hint={lang === "he"
              ? "כל לקוח שכותב לבוט נשמר כאן אוטומטית, כולל היסטוריית התורים שלו."
              : "Every customer who messages the bot is saved here automatically, with their booking history."}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="ps-3 pe-1 py-3">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={toggleSelectAll}
                    onClick={(e) => e.stopPropagation()}
                  />
                </th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">{t.customerIdCol}</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">{t.customer}</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium">{t.customerPhoneCol}</th>
                <th className="text-start px-4 py-3 text-gray-500 font-medium text-end">{t.totalBookings}</th>
                <th className="px-4 py-3" />
                <th className="ps-1 pe-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr
                  key={c.id}
                  onClick={() => setOpen(c)}
                  className={`cursor-pointer hover:bg-gray-50 transition ${i !== filtered.length - 1 ? "border-b border-gray-200/50" : ""}`}
                >
                  <td className="ps-3 pe-1 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs" dir="ltr">{customerDisplayId(c.id)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#1B7FA0]/20 border border-[#145F78]/40 flex items-center justify-center text-[#5BB8D4] font-semibold text-sm shrink-0">
                        {(c.name ?? c.phone).charAt(0).toUpperCase()}
                      </div>
                      <span className="text-gray-700 font-medium">{c.name ?? <span className="text-gray-400 italic">—</span>}</span>
                      {c.botPaused && (
                        <span title={lang === "he" ? "בניהול ידני" : "Manually handled"} className="text-sm shrink-0">🙋</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs" dir="ltr">{formatPhone(c.phone)}</td>
                  <td className="px-4 py-3 text-end">
                    <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                      {c._count.appointments}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-end">
                    <button
                      onClick={(e) => { e.stopPropagation(); setOpen(c); }}
                      className="text-xs text-[#1B7FA0] hover:text-white bg-[#1B7FA0]/10 hover:bg-[#1B7FA0] transition border border-[#1B7FA0]/30 px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 font-medium"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.9 9.9 0 01-4.29-.98L3 20l1.3-3.9C3.47 15.03 3 13.57 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      {t.viewConversation}
                    </button>
                  </td>
                  <td className="ps-1 pe-3">
                    <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
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
