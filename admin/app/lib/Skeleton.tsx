/** Shared skeleton-loading primitives — a subtly pulsing gray block matching the dashboard's design system. */
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-gray-200/70 ${className}`} />;
}

export function SkeletonStatCard() {
  return (
    <div className="rounded-2xl p-6 flex flex-col gap-3" style={{ background: "#FFFFFF", border: "1px solid #E5E5F0" }}>
      <div className="flex items-center justify-between">
        <SkeletonBlock className="h-3 w-16" />
        <SkeletonBlock className="h-7 w-7 rounded-lg" />
      </div>
      <SkeletonBlock className="h-7 w-20" />
      <SkeletonBlock className="h-3 w-24" />
    </div>
  );
}

export function SkeletonRow({ cols = 3 }: { cols?: number }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <SkeletonBlock className="h-8 w-8 rounded-full shrink-0" />
      {Array.from({ length: cols }).map((_, i) => (
        <SkeletonBlock key={i} className={`h-3.5 ${i === 0 ? "flex-1" : "w-16"}`} />
      ))}
    </div>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-2xl p-6 flex flex-col gap-3" style={{ background: "#FFFFFF", border: "1px solid #E5E5F0" }}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock key={i} className={`h-4 ${i === lines - 1 ? "w-3/5" : "w-full"}`} />
      ))}
    </div>
  );
}
