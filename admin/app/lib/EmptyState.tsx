import Link from "next/link";

/**
 * Shared empty-state: a new business sees mostly empty pages in its first week, which is exactly
 * when the product impression is formed — so an empty table gets a warm icon + one-line
 * explanation + a clear "what to do next" action instead of a lone gray sentence.
 */
export function EmptyState({
  icon,
  title,
  hint,
  actionLabel,
  actionHref,
}: {
  icon: string;
  title: string;
  hint?: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="text-center py-14 px-6">
      <div
        className="mx-auto mb-4 w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
        style={{ background: "rgba(27,127,160,0.07)", border: "1px solid rgba(27,127,160,0.12)" }}
      >
        {icon}
      </div>
      <p className="text-sm font-semibold text-gray-800">{title}</p>
      {hint && <p className="text-xs text-gray-400 mt-1.5 max-w-xs mx-auto leading-relaxed">{hint}</p>}
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="inline-block mt-5 bg-[#1B7FA0] hover:bg-[#2A9BBF] text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
