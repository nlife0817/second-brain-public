"use client";

// Skeleton placeholder used while planning pages load. Concept §20.3.

interface Props {
  className?: string;
  lines?: number;
}

// Deterministic widths so the placeholder is stable across renders.
const PSEUDO_WIDTHS = [82, 67, 91, 73, 88, 64];

export function SkeletonBlock({ className, lines = 3 }: Props) {
  return (
    <div className={`animate-pulse rounded-xl bg-slate-100 ${className ?? "h-32"}`}>
      <div className="space-y-2 p-4">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-2 rounded bg-slate-200" style={{ width: `${PSEUDO_WIDTHS[i % PSEUDO_WIDTHS.length]}%` }} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBlock key={i} />
      ))}
    </div>
  );
}
