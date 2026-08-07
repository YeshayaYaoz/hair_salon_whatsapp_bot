"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SkeletonBlock, SkeletonRow } from "../../lib/Skeleton";
import { EmptyState } from "../../lib/EmptyState";
import { formatPhone } from "../../lib/formatPhone";
import { useDialog } from "../../lib/useDialog";
import { DIAL_CODES, dialCodeOf, localPartOf } from "../../lib/dialCodes";

interface Customer {
  id: string;
  name?: string;
  phone: string;
  notes?: string | null;
  botPaused?: boolean;
  _count: { appointments: number };
}

/**
 * Avatar plus name for one customer.
 *
 * Most customers have no name: the bot only asks for one when a booking is being made, so anyone
 * who just asked a question is nameless, and that is the normal case rather than missing data. The
 * initial used to come from `name ?? phone`, so every one of those rows showed a circle containing
 * "9" — the first digit of the 972 country code — beside an em dash. Two pieces of furniture, no
 * information. A nameless customer now gets a neutral glyph and says so in words.
 */
function CustomerIdentity({ customer, he }: { customer: Customer; he: boolean }) {
  const name = customer.name?.trim();
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-[#1B7FA0]/20 border border-[#145F78]/40 flex items-center justify-center text-[#5BB8D4] font-semibold text-sm shrink-0">
        {name ? (
          name.charAt(0).toUpperCase()
        ) : (
          <svg className="w-4 h-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        )}
      </div>
      {name
        ? <span className="text-gray-700 font-medium truncate">{name}</span>
        : <span className="text-gray-500 truncate">{he ? "ללא שם" : "No name"}</span>}
      {customer.botPaused && (
        <span title={he ? "בניהול ידני" : "Manually handled"} className="text-sm shrink-0">🙋</span>
      )}
    </div>
  );
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

function ConversationPanel({
  customer, onClose, onNotesSaved, onPausedChanged, onDetailsSaved,
}: {
  customer: Customer; onClose: () => void; onNotesSaved: (notes: string) => void;
  onPausedChanged: (paused: boolean) => void;
  onDetailsSaved: (details: { name: string | null; phone: string }) => void;
}) {
  const { t, lang } = useLanguage();
  const he = lang === "he";
  const dialogRef = useDialog<HTMLDivElement>(onClose);
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
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(customer.name ?? "");
  const [editPhone, setEditPhone] = useState(localPartOf(customer.phone));
  const [editDial, setEditDial] = useState(dialCodeOf(customer.phone));
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  /**
   * Corrects the name or the number.
   *
   * The name is whatever the customer happened to tell the bot — often a first name, a nickname, or
   * nothing — and it is what the owner reads in every list and alert. The phone is the identity, so
   * the server refuses a number already used by another customer and carries the transcript across
   * when it changes; nothing here should attempt either locally.
   */
  async function saveEdit() {
    setSavingEdit(true);
    setEditError(null);
    try {
      const updated = await apiFetch<{ name: string | null; phone: string }>(
        `/api/business/customers/${customer.id}`,
        { method: "PATCH", body: JSON.stringify({ name: editName, phone: editPhone, dialCode: editDial }) }
      );
      onDetailsSaved(updated);
      setEditOpen(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : (he ? "השמירה נכשלה" : "Couldn't save"));
    } finally {
      setSavingEdit(false);
    }
  }

  /** Makes the bot treat the next incoming message as the start of a new conversation. The
   * transcript below is untouched — that's the whole point of it being separate from deleting. */
  async function resetConversation() {
    if (!confirm(he
      ? "לפתוח שיחה חדשה? הבוט יתייחס להודעה הבאה כתחילת שיחה ולא יזכור את מה שנאמר עד כה. היסטוריית ההודעות נשמרת ותמשיך להופיע כאן."
      : "Start a fresh conversation? The bot will treat the next message as a new chat and won't remember what was said so far. The transcript is kept and stays visible here.")) return;
    setResetting(true);
    try {
      await apiFetch(`/api/business/customers/${customer.id}/reset-conversation`, { method: "POST" });
      setResetDone(true);
      setTimeout(() => setResetDone(false), 4000);
    } catch {
      // best-effort — the button stays clickable to retry
    } finally {
      setResetting(false);
    }
  }

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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={customer.name ?? customer.phone}
        onClick={(e) => e.stopPropagation()}
        className="relative bg-white w-full max-w-md h-full flex flex-col shadow-2xl animate-fade-in"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-[#1B7FA0]/20 border border-[#145F78]/40 flex items-center justify-center text-[#5BB8D4] font-semibold text-sm shrink-0">
              {customer.name?.trim()
                ? customer.name.trim().charAt(0).toUpperCase()
                : (
                  <svg className="w-4 h-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">{customer.name?.trim() || formatPhone(customer.phone)}</div>
              <button
                onClick={() => { setEditOpen((v) => !v); setEditError(null); }}
                className="text-xs text-gray-600 font-mono hover:text-[#145F78] transition flex items-center gap-1"
                dir="ltr"
                title={he ? "עריכת פרטי הלקוח" : "Edit customer details"}
              >
                <span>{formatPhone(customer.phone)}</span>
                <svg className="w-3 h-3 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={resetConversation}
              disabled={resetting}
              title={he ? "הבוט יתחיל שיחה חדשה — ההיסטוריה נשמרת" : "The bot starts a new conversation — history is kept"}
              className="text-xs font-medium text-gray-600 hover:text-[#145F78] hover:bg-[#1B7FA0]/10 disabled:opacity-50 px-2 py-1.5 rounded-lg transition"
            >
              {resetting ? "…" : resetDone ? (he ? "אופס ✓" : "Reset ✓") : (he ? "שיחה חדשה" : "New chat")}
            </button>
            {!botPaused && (
              <button
                onClick={() => toggleBotPaused(true)}
                disabled={togglingPause}
                title={he ? "השתק בוט לשיחה זו" : "Mute the bot on this thread"}
                className="text-xs font-medium text-gray-600 hover:text-amber-700 hover:bg-amber-50 disabled:opacity-50 px-2 py-1.5 rounded-lg transition"
              >
                {he ? "השתקת בוט" : "Mute bot"}
              </button>
            )}
            <button onClick={onClose} aria-label={he ? "סגירה" : "Close"} className="text-gray-600 hover:text-gray-900 transition p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {editOpen && (
          <div className="px-5 py-3 border-b border-gray-100 shrink-0 bg-gray-50/70 flex flex-col gap-2">
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder={he ? "שם הלקוח" : "Customer name"}
              className="w-full text-sm"
            />
            <div className="flex gap-2">
              <select value={editDial} onChange={(e) => setEditDial(e.target.value)} className="w-32 shrink-0 text-sm" dir="ltr">
                {DIAL_CODES.map((c) => <option key={c.code} value={c.code}>+{c.code}</option>)}
              </select>
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="w-full text-sm" dir="ltr" />
            </div>
            {editError && <p className="text-xs text-red-600">{editError}</p>}
            <div className="flex items-center gap-2">
              <button
                onClick={saveEdit}
                disabled={savingEdit}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#1B7FA0] text-white hover:bg-[#2A9BBF] disabled:opacity-50"
              >
                {savingEdit ? (he ? "שומר…" : "Saving…") : (he ? "שמירה" : "Save")}
              </button>
              <button
                onClick={() => { setEditOpen(false); setEditError(null); setEditName(customer.name ?? ""); setEditPhone(localPartOf(customer.phone)); setEditDial(dialCodeOf(customer.phone)); }}
                className="text-xs font-medium px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100"
              >
                {he ? "ביטול" : "Cancel"}
              </button>
              <span className="text-[11px] text-gray-500 ms-auto">
                {he ? "שינוי מספר מעביר גם את היסטוריית השיחה" : "Changing the number moves the transcript too"}
              </span>
            </div>
          </div>
        )}

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
            <label className="text-xs font-semibold text-gray-600">{he ? "הערה על הלקוח" : "Customer note"}</label>
            {savingNotes && <span className="text-[10px] text-gray-600">{he ? "שומר…" : "Saving…"}</span>}
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
            <p className="text-gray-600 text-sm text-center py-10">{he ? "עדיין אין הודעות עם לקוח זה" : "No messages with this customer yet"}</p>
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
                  <span className="block text-[10px] text-gray-600 mt-1">{fmtDate(m.createdAt)}</span>
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
  const dialogRef = useDialog<HTMLDivElement>(onClose);
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
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-msg-title"
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 id="bulk-msg-title" className="text-sm font-semibold text-gray-900">{he ? "הודעה קבוצתית" : "Bulk message"}</h2>
            <p className="text-xs text-gray-600">{he ? `אל ${customers.length} לקוחות` : `To ${customers.length} customers`}</p>
          </div>
          <button onClick={onClose} aria-label={he ? "סגירה" : "Close"} className="text-gray-600 hover:text-gray-900 transition">
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
  const [resettingAll, setResettingAll] = useState(false);
  const [resetAllDone, setResetAllDone] = useState(false);

  const [loaded, setLoaded] = useState(false);

  /** Makes the bot open a new conversation with every customer. Transcripts are kept — the reset
   * moves a marker rather than deleting, so the confirm has to say so or it reads as destructive. */
  async function resetAllConversations() {
    if (!confirm(he
      ? `לפתוח שיחה חדשה מול כל ${customers.length} הלקוחות? הבוט לא יזכור מה נאמר עד כה בשום שיחה. היסטוריית ההודעות נשמרת במלואה וממשיכה להופיע בכרטיס כל לקוח.`
      : `Start a fresh conversation with all ${customers.length} customers? The bot won't remember anything said so far in any thread. Every transcript is kept and stays visible on each customer.`)) return;
    setResettingAll(true);
    try {
      await apiFetch("/api/business/conversations/reset-all", { method: "POST" });
      setResetAllDone(true);
      setTimeout(() => setResetAllDone(false), 4000);
    } catch {
      // best-effort — the button stays clickable to retry
    } finally {
      setResettingAll(false);
    }
  }

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
          onDetailsSaved={({ name, phone }) => {
            // The server normalizes the number, so take what it stored rather than what was typed.
            const patch = { name: name ?? undefined, phone };
            setCustomers((prev) => prev.map((c) => (c.id === open.id ? { ...c, ...patch } : c)));
            setOpen((prev) => (prev ? { ...prev, ...patch } : prev));
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
          <p className="text-gray-600 text-sm mt-1">{customers.length} {t.totalCustomers}</p>
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
          <button
            onClick={resetAllConversations}
            disabled={resettingAll}
            title={he
              ? "הבוט יתחיל שיחה חדשה מול כל הלקוחות — ההיסטוריה נשמרת"
              : "The bot starts fresh with every customer — history is kept"}
            className="text-xs font-semibold text-gray-600 hover:text-[#145F78] hover:bg-[#1B7FA0]/10 disabled:opacity-50 border border-gray-200 px-3 py-2 rounded-lg transition"
          >
            {resettingAll ? "…" : resetAllDone ? (he ? "אופס ✓" : "Reset ✓") : (he ? "אפס את כל השיחות" : "Reset all chats")}
          </button>
          <input
            placeholder={t.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
        </div>
      </div>

      <div className="flex items-center gap-2.5 mb-4 px-4 py-2.5 rounded-lg bg-[#1B7FA0]/8 border border-[#1B7FA0]/20 animate-fade-up stagger-1">
        <svg className="w-4 h-4 text-[#197492] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                {/* Every column hugs its content except the name, which absorbs the slack. Sharing
                    it between all seven instead left each cell floating in the middle of its own
                    gap, far from the header above it. */}
                <th className="ps-3 pe-1 py-3 w-px">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={toggleSelectAll}
                    onClick={(e) => e.stopPropagation()}
                  />
                </th>
                <th className="text-start px-4 py-3 text-gray-600 font-medium">{t.customer}</th>
                <th className="text-start px-4 py-3 text-gray-600 font-medium w-px whitespace-nowrap">{t.customerPhoneCol}</th>
                <th className="text-end px-4 py-3 text-gray-600 font-medium w-px whitespace-nowrap">{t.totalBookings}</th>
                <th className="px-4 py-3 w-px" />
                <th className="ps-1 pe-3 w-px" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr
                  key={c.id}
                  onClick={() => setOpen(c)}
                  className={`cursor-pointer hover:bg-gray-50 transition ${i !== filtered.length - 1 ? "border-b border-gray-200/50" : ""}`}
                >
                  <td className="ps-3 pe-1 py-3 w-px">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <CustomerIdentity customer={c} he={lang === "he"} />
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs w-px whitespace-nowrap" dir="ltr">{formatPhone(c.phone)}</td>
                  <td className="px-4 py-3 text-end w-px whitespace-nowrap">
                    <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                      {c._count.appointments}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-end w-px whitespace-nowrap">
                    <button
                      onClick={(e) => { e.stopPropagation(); setOpen(c); }}
                      className="row-action text-xs text-[#197492] hover:text-white bg-[#1B7FA0]/10 hover:bg-[#1B7FA0] transition border border-[#1B7FA0]/30 px-3 py-1.5 rounded-lg gap-1.5 font-medium"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.9 9.9 0 01-4.29-.98L3 20l1.3-3.9C3.47 15.03 3 13.57 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      {t.viewConversation}
                    </button>
                  </td>
                  <td className="ps-1 pe-3 w-px">
                    <svg className="w-4 h-4 text-gray-300 rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
