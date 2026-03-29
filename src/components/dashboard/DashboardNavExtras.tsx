"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function DashboardNavExtras() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/kabir/memory-snippet")
      .then((r) => r.json())
      .then((d: { memoryBadgeCount?: number }) => {
        if (!cancelled && typeof d.memoryBadgeCount === "number") {
          setCount(d.memoryBadgeCount);
        }
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Link
      href="/dashboard/memory"
      className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/35 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-100/95 transition-colors hover:border-violet-400/45 hover:bg-cyan-500/15"
    >
      <span className="relative h-1.5 w-1.5 rounded-full bg-violet-400/90" aria-hidden />
      what kabir knows
      {count !== null && count > 0 ? (
        <span className="rounded-full bg-violet-500/25 px-1.5 py-0 text-[10px] font-semibold tabular-nums text-violet-200">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
