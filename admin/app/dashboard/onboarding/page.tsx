"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { useLanguage } from "../../lib/LanguageContext";
import { SkeletonCard } from "../../lib/Skeleton";

interface TemplateCard {
  type: string;
  emoji: string;
  labelHe: string;
  labelEn: string;
  descriptionHe: string;
  depositEnabled: boolean;
  depositAmountIls: number;
  reviewsEnabled: boolean;
  sampleServices: string[];
}

export default function OnboardingPage() {
  const { lang } = useLanguage();
  const he = lang === "he";
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateCard[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ templates: TemplateCard[] }>("/api/business/me/templates")
      .then((d) => setTemplates(d.templates))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  async function confirm() {
    if (!selected) return;
    setApplying(true);
    setError(null);
    try {
      await apiFetch("/api/business/me/apply-template", {
        method: "POST",
        body: JSON.stringify({ type: selected }),
      });
      router.replace("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply");
      setApplying(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <div className="mb-8 text-center animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900">
          {he ? "איזה סוג עסק אתם?" : "What kind of business are you?"}
        </h1>
        <p className="text-gray-600 text-sm mt-2 max-w-lg mx-auto">
          {he
            ? "בחרו קטגוריה ותורי תגדיר עבורכם הכל מראש — שירותים לדוגמה, מדיניות ביטולים, טון הבוט ועוד. תמיד אפשר לשנות אחר כך."
            : "Pick a category and Tori will pre-configure everything — sample services, cancellation policy, bot tone and more. You can change anything later."}
        </p>
      </div>

      {!templates ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 animate-fade-up stagger-1">
          {templates.map((tpl) => {
            const isSel = selected === tpl.type;
            return (
              <button
                key={tpl.type}
                onClick={() => setSelected(tpl.type)}
                className={`text-start bg-white rounded-2xl p-5 border-2 transition ${
                  isSel ? "border-[#1B7FA0] shadow-lg" : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-3xl">{tpl.emoji}</span>
                  <span className="text-lg font-bold text-gray-900">{he ? tpl.labelHe : tpl.labelEn}</span>
                  {isSel && (
                    <span className="ms-auto w-6 h-6 rounded-full bg-[#1B7FA0] text-white flex items-center justify-center text-sm">
                      ✓
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600 leading-relaxed mb-3">{tpl.descriptionHe}</p>
                <div className="flex flex-wrap gap-1.5">
                  {tpl.sampleServices.map((s) => (
                    <span key={s} className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                      {s}
                    </span>
                  ))}
                </div>
                <div className="flex gap-3 mt-3 text-xs text-gray-500">
                  {tpl.depositEnabled && <span>💳 {he ? `מקדמה ₪${tpl.depositAmountIls}` : `Deposit ₪${tpl.depositAmountIls}`}</span>}
                  {tpl.reviewsEnabled && <span>⭐ {he ? "בקשת ביקורת" : "Review requests"}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="text-red-600 text-sm mt-4 text-center">{error}</p>}

      <div className="mt-8 flex justify-center">
        <button
          onClick={confirm}
          disabled={!selected || applying}
          className="bg-[#1B7FA0] hover:bg-[#2A9BBF] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-8 py-3 rounded-xl transition"
        >
          {applying
            ? (he ? "מגדיר..." : "Setting up...")
            : (he ? "המשך והגדר את תורי" : "Continue & set up Tori")}
        </button>
      </div>
    </div>
  );
}
