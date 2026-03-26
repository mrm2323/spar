"use client";

import { useMemo } from "react";

type InsightScore = {
  key: string;
  label: string;
  value: number;
  detail: string;
};

interface UnderstandingMapProps {
  sessionCount: number;
  patterns: Array<{ name: string; sessionCount: number }>;
  people: Array<{ relationship?: string }>;
  goalEntries: Array<{ metadata?: { kabirNoticedAt?: string } }>;
}

export function UnderstandingMap({
  sessionCount,
  patterns,
  people,
  goalEntries,
}: UnderstandingMapProps) {
  const insightScores = useMemo<InsightScore[]>(() => {
    // Consistency: 12% per session, capped at 100%, starting from 0
    const consistency = Math.min(100, Math.max(0, sessionCount * 12));

    // Pattern clarity: 5% per pattern session count, capped at 100%, starting from 0
    const patternClarity = Math.min(
      100,
      patterns.reduce((acc, p) => acc + Math.min(22, p.sessionCount * 5), 0)
    );

    // People depth: 16% per person + 8% for those with explicit relationships
    const peopleDepth = Math.min(
      100,
      people.length * 16 + people.filter((p) => p.relationship).length * 8
    );

    // Goal follow-through: % of goals where Kabir noticed progress
    const progressedGoals = goalEntries.filter(
      (g) => typeof g.metadata?.kabirNoticedAt === "string" && g.metadata.kabirNoticedAt
    ).length;
    const goalFollowThrough =
      goalEntries.length === 0
        ? 0
        : Math.min(100, Math.round((progressedGoals / goalEntries.length) * 100));

    return [
      {
        key: "consistency",
        label: "Conversation consistency",
        value: consistency,
        detail: `${sessionCount} completed session${sessionCount === 1 ? "" : "s"}`,
      },
      {
        key: "patterns",
        label: "Pattern clarity",
        value: patternClarity,
        detail: `${patterns.length} communication pattern${patterns.length === 1 ? "" : "s"} tracked`,
      },
      {
        key: "people",
        label: "People context depth",
        value: peopleDepth,
        detail: `${people.length} person${people.length === 1 ? "" : "s"} in memory`,
      },
      {
        key: "goals",
        label: "Goal follow-through",
        value: goalFollowThrough,
        detail:
          goalEntries.length === 0
            ? "No goals added yet"
            : `${progressedGoals}/${goalEntries.length} goals show progress`,
      },
    ];
  }, [sessionCount, patterns, people, goalEntries]);

  // Only show map if there's at least one metric with real data
  const hasData = sessionCount > 0 || patterns.length > 0 || people.length > 0 || goalEntries.length > 0;
  if (!hasData) return null;

  const CARD = "rounded-xl border border-slate-700/55 bg-[#0b1d3e]/50 shadow-[0_0_0_1px_rgba(15,23,42,0.4)]";

  return (
    <section className={`${CARD} p-6`}>
      <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-400/80">
        Kabir understanding map
      </h2>
      <p className="mt-2 text-xs text-slate-500">
        How much context Kabir has built across your sessions.
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
                className="h-full rounded-full bg-gradient-to-r from-cyan-500/80 to-emerald-400/80 transition-all"
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
