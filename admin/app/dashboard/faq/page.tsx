"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

interface FaqEntry {
  id: string;
  question: string;
  answer: string;
}

export default function FaqPage() {
  const [entries, setEntries] = useState<FaqEntry[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function load() {
    setEntries(await apiFetch<FaqEntry[]>("/api/business/faq"));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      await apiFetch("/api/business/faq", { method: "POST", body: JSON.stringify({ question, answer }) });
      setQuestion("");
      setAnswer("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add FAQ entry");
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    await apiFetch(`/api/business/faq/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">FAQ</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Common questions and answers your WhatsApp bot can use to respond to customers (e.g. parking, payment methods, cancellation policy).
        </p>
      </div>

      <div className="flex flex-col gap-3 mb-6">
        {entries.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-10 text-center text-zinc-500 text-sm">
            No FAQ entries yet. Add one below.
          </div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-zinc-100 font-medium text-sm mb-1">{entry.question}</p>
                  <p className="text-zinc-400 text-sm">{entry.answer}</p>
                </div>
                <button
                  onClick={() => remove(entry.id)}
                  className="shrink-0 text-xs text-zinc-500 hover:text-red-400 transition px-2 py-1 rounded hover:bg-red-950/30"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4">Add an entry</h2>
        <form onSubmit={addEntry} className="flex flex-col gap-3">
          <input
            placeholder="Question (e.g. Do you have parking?)"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
          />
          <textarea
            placeholder="Answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            required
            rows={3}
            className="resize-none"
          />
          <button
            type="submit"
            disabled={adding}
            className="self-start bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            {adding ? "Adding..." : "Add"}
          </button>
        </form>
        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
      </div>
    </div>
  );
}
