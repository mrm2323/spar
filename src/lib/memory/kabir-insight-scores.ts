/**
 * Single source of truth for “Kabir understanding” percentages shown on the
 * dashboard map and the memory portrait. Same inputs → same numbers everywhere.
 */

export type KabirInsightInputs = {
  sessionCount: number;
  patterns: Array<{ name: string; sessionCount: number }>;
  people: Array<{ relationship?: string }>;
  goalEntries: Array<{ metadata?: { kabirNoticedAt?: string } }>;
};

export type KabirInsightKey = "consistency" | "patterns" | "people" | "goals";

export type KabirInsightMetric = {
  key: KabirInsightKey;
  /** 0–100 */
  value: number;
};

/**
 * Consistency: 12% per completed session on the dashboard thread list, capped at 100%.
 * Pattern clarity: up to ~22 points per pattern from tracked session weight.
 * People depth: 16% per person + 8% when relationship is set.
 * Goals: % of goals where Kabir noticed progress.
 */
export function computeKabirInsightMetrics(
  input: KabirInsightInputs
): KabirInsightMetric[] {
  const { sessionCount, patterns, people, goalEntries } = input;

  const consistency = Math.min(100, Math.max(0, sessionCount * 12));

  const patternClarity = Math.min(
    100,
    patterns.reduce((acc, p) => acc + Math.min(22, p.sessionCount * 5), 0)
  );

  const peopleDepth = Math.min(
    100,
    people.length * 16 + people.filter((p) => p.relationship).length * 8
  );

  const progressedGoals = goalEntries.filter(
    (g) => typeof g.metadata?.kabirNoticedAt === "string" && g.metadata.kabirNoticedAt
  ).length;
  const goalFollowThrough =
    goalEntries.length === 0
      ? 0
      : Math.min(100, Math.round((progressedGoals / goalEntries.length) * 100));

  return [
    { key: "consistency", value: consistency },
    { key: "patterns", value: patternClarity },
    { key: "people", value: peopleDepth },
    { key: "goals", value: goalFollowThrough },
  ];
}
