"use client";

export function SavedBadge({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-green-400 text-sm animate-slide-in-end">
      <svg className="w-4 h-4 animate-pop" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
      {text}
    </span>
  );
}
