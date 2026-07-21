"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SkeletonCard } from "../../lib/Skeleton";

interface FaqEntry {
  id: string;
  question: string;
  answer: string;
}

export default function FaqPage() {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<FaqEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function load() {
    setEntries(await apiFetch<FaqEntry[]>("/api/business/faq"));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message)).finally(() => setLoaded(true));
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
    <div className="animate-fade-in">
      <div className="mb-6 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">{t.faqTitle}</h1>
        <p className="text-gray-500 text-sm mt-1">{t.faqSubtitle}</p>
      </div>

      <div className="flex flex-col gap-3 mb-6">
        {!loaded ? (
          <><SkeletonCard lines={2} /><SkeletonCard lines={2} /></>
        ) : entries.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl px-6 py-10 text-center text-gray-400 text-sm">
            {t.noFaq}
          </div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-gray-800 font-medium text-sm mb-1">{entry.question}</p>
                  <p className="text-gray-500 text-sm">{entry.answer}</p>
                </div>
                <button
                  onClick={() => remove(entry.id)}
                  className="shrink-0 text-xs text-gray-400 hover:text-red-600 transition px-2 py-1 rounded hover:bg-red-950/30"
                >
                  {t.delete}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-600 mb-4">{t.addFaqEntry}</h2>
        <form onSubmit={addEntry} className="flex flex-col gap-3">
          <input
            placeholder={t.questionPlaceholder}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
          />
          <textarea
            placeholder={t.answerPlaceholder}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            required
            rows={3}
            className="resize-none"
          />
          <button
            type="submit"
            disabled={adding}
            className="self-start bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            {adding ? "…" : t.add}
          </button>
        </form>
        {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
      </div>
    </div>
  );
}
