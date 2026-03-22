import { createSupabaseAdmin } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type RangeKey = "1h" | "24h" | "7d" | "30d";

function toRangeKey(value: string | null): RangeKey {
  if (value === "1h" || value === "24h" || value === "7d" || value === "30d") {
    return value;
  }
  return "24h";
}

function getRangeStart(range: RangeKey): Date {
  const now = Date.now();
  switch (range) {
    case "1h":
      return new Date(now - 60 * 60 * 1000);
    case "7d":
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now - 30 * 24 * 60 * 60 * 1000);
    case "24h":
    default:
      return new Date(now - 24 * 60 * 60 * 1000);
  }
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const total = nums.reduce((a, b) => a + b, 0);
  return Number((total / nums.length).toFixed(2));
}

function requireAdminPassword(req: Request): string | null {
  const expected =
    process.env.ADMIN_PASSWORD ||
    process.env.NEXT_PUBLIC_ADMIN_PASSWORD ||
    process.env.VITE_ADMIN_PASSWORD;

  if (!expected) return "Admin password is not configured on server.";

  const provided = req.headers.get("x-admin-password");
  if (!provided || provided !== expected) return "Unauthorized";

  return null;
}

export async function GET(req: Request) {
  const authError = requireAdminPassword(req);
  if (authError === "Unauthorized") {
    return NextResponse.json({ error: authError }, { status: 401 });
  }
  if (authError) {
    return NextResponse.json({ error: authError }, { status: 500 });
  }

  const url = new URL(req.url);
  const range = toRangeKey(url.searchParams.get("range"));
  const start = getRangeStart(range).toISOString();

  const supabase = createSupabaseAdmin();

  const [feedbackRes, sessionsRes] = await Promise.all([
    supabase
      .from("session_feedback")
      .select("call_rating, csat_recommend_score, call_feedback, submitted_at, source")
      .gte("submitted_at", start)
      .order("submitted_at", { ascending: false }),
    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .gte("ended_at", start),
  ]);

  if (feedbackRes.error) {
    console.error("[admin csat feedback query]", feedbackRes.error);
    return NextResponse.json({ error: feedbackRes.error.message }, { status: 500 });
  }

  if (sessionsRes.error) {
    console.error("[admin csat sessions query]", sessionsRes.error);
    return NextResponse.json({ error: sessionsRes.error.message }, { status: 500 });
  }

  const feedbackRows = feedbackRes.data || [];
  const completedSessions = sessionsRes.count || 0;

  const callRatings = feedbackRows.map((r) => Number(r.call_rating)).filter((n) => Number.isFinite(n));
  const recommendScores = feedbackRows
    .map((r) => Number(r.csat_recommend_score))
    .filter((n) => Number.isFinite(n));

  const recommendDistribution = Array.from({ length: 10 }).map((_, idx) => ({
    score: idx + 1,
    count: 0,
  }));

  for (const score of recommendScores) {
    if (score >= 1 && score <= 10) {
      recommendDistribution[score - 1].count += 1;
    }
  }

  let detractors = 0;
  let passives = 0;
  let promoters = 0;
  for (const score of recommendScores) {
    if (score <= 6) detractors += 1;
    else if (score <= 8) passives += 1;
    else promoters += 1;
  }

  const npsScore =
    recommendScores.length > 0
      ? Math.round(((promoters - detractors) / recommendScores.length) * 100)
      : null;

  const responseRate =
    completedSessions > 0
      ? Number(((feedbackRows.length / completedSessions) * 100).toFixed(2))
      : 0;

  const trendMap = new Map<string, { day: string; avg_rating_total: number; avg_score_total: number; count: number }>();
  for (const row of feedbackRows) {
    const day = new Date(row.submitted_at).toISOString().slice(0, 10);
    const existing = trendMap.get(day) || {
      day,
      avg_rating_total: 0,
      avg_score_total: 0,
      count: 0,
    };

    existing.avg_rating_total += Number(row.call_rating);
    existing.avg_score_total += Number(row.csat_recommend_score);
    existing.count += 1;

    trendMap.set(day, existing);
  }

  const trend = [...trendMap.values()]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((item) => ({
      day: item.day,
      feedback_count: item.count,
      avg_call_rating: Number((item.avg_rating_total / item.count).toFixed(2)),
      avg_recommend_score: Number((item.avg_score_total / item.count).toFixed(2)),
    }));

  const recentFeedback = feedbackRows
    .filter((row) => typeof row.call_feedback === "string" && row.call_feedback.trim().length > 0)
    .slice(0, 20)
    .map((row) => ({
      submitted_at: row.submitted_at,
      call_rating: row.call_rating,
      csat_recommend_score: row.csat_recommend_score,
      call_feedback: row.call_feedback,
      source: row.source,
    }));

  return NextResponse.json({
    range,
    from: start,
    totals: {
      completed_sessions: completedSessions,
      feedback_responses: feedbackRows.length,
      response_rate_percent: responseRate,
    },
    metrics: {
      avg_call_rating: avg(callRatings),
      avg_recommend_score: avg(recommendScores),
      nps_score: npsScore,
      nps_buckets: {
        detractors,
        passives,
        promoters,
      },
      recommend_distribution: recommendDistribution,
    },
    trend,
    recent_feedback: recentFeedback,
  });
}
