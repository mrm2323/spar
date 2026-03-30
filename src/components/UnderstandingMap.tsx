"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  computeKabirInsightMetrics,
  type KabirInsightKey,
} from "@/lib/memory/kabir-insight-scores";

type InsightScore = {
  key: KabirInsightKey;
  label: string;
  value: number;
  detail: string;
};

interface UnderstandingMapProps {
  sessionCount: number;
  people: Array<{ relationship?: string }>;
  goalEntries: Array<{ metadata?: { kabirNoticedAt?: string } }>;
}

export function UnderstandingMap({
  sessionCount,
  people,
  goalEntries,
}: UnderstandingMapProps) {
  const insightScores = useMemo<InsightScore[]>(() => {
    const progressedGoals = goalEntries.filter(
      (g) => typeof g.metadata?.kabirNoticedAt === "string" && g.metadata.kabirNoticedAt
    ).length;
    const metrics = computeKabirInsightMetrics({
      sessionCount,
      patterns: [],
      people,
      goalEntries,
    });
    const byKey = Object.fromEntries(metrics.map((m) => [m.key, m.value])) as Record<
      KabirInsightKey,
      number
    >;

    return [
      {
        key: "consistency",
        label: "Conversation consistency",
        value: byKey.consistency,
        detail: `${sessionCount} completed session${sessionCount === 1 ? "" : "s"}`,
      },
      {
        key: "people",
        label: "People context depth",
        value: byKey.people,
        detail: `${people.length} person${people.length === 1 ? "" : "s"} in memory`,
      },
      {
        key: "goals",
        label: "Goal follow-through",
        value: byKey.goals,
        detail:
          goalEntries.length === 0
            ? "No goals added yet"
            : `${progressedGoals}/${goalEntries.length} goals show progress`,
      },
    ];
  }, [sessionCount, people, goalEntries]);

  // Only show map if there's at least one metric with real data
  const hasData = sessionCount > 0 || people.length > 0 || goalEntries.length > 0;
  if (!hasData) return null;

  const CARD =
    "rounded-2xl border border-white/[0.08] bg-[#12121a]/90 shadow-[0_0_0_1px_rgba(15,23,42,0.35)]";

  return (
    <section className={`${CARD} p-6`}>
      <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-400/80">
        Kabir understanding map
      </h2>
      <p className="mt-2 text-xs text-slate-500">
        How much context Kabir has built across your sessions. Same numbers as{" "}
        <Link
          href="/dashboard/memory"
          className="text-cyan-400/90 underline decoration-cyan-500/30 underline-offset-2 hover:text-cyan-300"
        >
          what kabir knows
        </Link>
        .
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {insightScores.map((item) => (
          <div
            key={item.key}
            className="rounded-lg border border-slate-700/50 bg-slate-950/35 p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-slate-200">{item.label}</p>
              <span className="font-mono text-[11px] text-cyan-300">{item.value}%</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500/80 to-violet-500/75 transition-all"
                style={{ width: `${item.value}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">{item.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
