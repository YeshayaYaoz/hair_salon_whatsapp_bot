"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";

interface ConversationSummary {
  phone: string;
  customerName: string | null;
  messageCount: number;
  lastMessageAt: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export default function ConversationsPage() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<ConversationSummary[]>("/api/business/conversations").then(setList).catch(() => {});
  }, []);

  async function open(phone: string) {
    setSelected(phone);
    setLoading(true);
    try {
      setMessages(await apiFetch<Message[]>(`/api/business/conversations/${encodeURIComponent(phone)}`));
    } finally {
      setLoading(false);
    }
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleString(he ? "he-IL" : "en-US", { timeZone: "Asia/Jerusalem", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{he ? "שיחות הבוט" : "Bot conversations"}</h1>
        <p className="text-gray-500 text-sm mt-1">
          {he ? "צפה בשיחות שהבוט ניהל עם הלקוחות שלך." : "See the conversations the bot had with your customers."}
        </p>
      </div>

      <div className="grid md:grid-cols-[300px_1fr] gap-4">
        {/* Conversation list */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden max-h-[70vh] overflow-y-auto">
          {list.length === 0 ? (
            <div className="px-5 py-10 text-center text-gray-400 text-sm">
              {he ? "עדיין אין שיחות" : "No conversations yet"}
            </div>
          ) : (
            <ul>
              {list.map((c) => (
                <li key={c.phone}>
                  <button
                    onClick={() => open(c.phone)}
                    className={`w-full text-start px-4 py-3 border-b border-gray-100 transition ${selected === c.phone ? "bg-[#1B7FA0]/8" : "hover:bg-gray-50"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-800 truncate">{c.customerName || c.phone}</span>
                      <span className="text-[10px] text-gray-400 shrink-0">{fmtDate(c.lastMessageAt)}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{c.messageCount} {he ? "הודעות" : "messages"}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Transcript */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 max-h-[70vh] overflow-y-auto">
          {!selected ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm py-20">
              {he ? "בחר שיחה כדי לצפות בתמלול" : "Select a conversation to view the transcript"}
            </div>
          ) : loading ? (
            <p className="text-gray-400 text-sm">{he ? "טוען…" : "Loading…"}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-[#DCF8C6] self-end rounded-br-sm text-gray-900"
                      : "bg-gray-100 self-start rounded-bl-sm text-gray-800"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  <span className="block text-[10px] text-gray-400 mt-1">{fmtDate(m.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
