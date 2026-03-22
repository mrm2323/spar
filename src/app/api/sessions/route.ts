import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { getUserSessionUsage } from "@/lib/session-cap";
import { NextResponse } from "next/server";

type EnrichedSession = {
  id: string;
  context: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  user_id: string;
  notes_preview: string | null;
  confidence: number | null;
};

const IGNORED_TOKENS = new Set([
  "key",
  "shift",
  "next",
  "move",
  "kabir",
  "practice",
  "session",
  "conversation",
  "your",
  "with",
  "this",
  "that",
  "from",
  "have",
  "been",
  "just",
]);

function toKeyText(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTokenSet(value: string | null | undefined): Set<string> {
  const clean = toKeyText(value);
  const words = clean.split(" ").filter((w) => w.length >= 4 && !IGNORED_TOKENS.has(w));
  return new Set(words);
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ sessions: [] });
  }

  const supabase = createSupabaseAdmin();
  const cap = await getUserSessionUsage(supabase, userId, {
    includeActive: true,
  });

  // Get the user's linked phone number
  const { data: memory } = await supabase
    .from("user_memory")
    .select("phone_number")
    .eq("user_id", userId)
    .single();

  // Build list of user IDs to query (Clerk ID + phone:number if linked)
  const userIds = [userId];
  if (memory?.phone_number) {
    userIds.push(`phone:${memory.phone_number}`);
  }

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, context, ended_at, duration_seconds, user_id")
    .in("user_id", userIds)
    .eq("status", "completed")
    .order("ended_at", { ascending: false })
    .limit(20);

  const list = sessions || [];
  const sessionIds = list.map((s) => s.id);

  const reportBySession: Record<
    string,
    { summary: string; overall_score: number | null }
  > = {};

  if (sessionIds.length > 0) {
    const { data: reports } = await supabase
      .from("forensics_reports")
      .select("session_id, summary, overall_score, created_at")
      .in("session_id", sessionIds)
      .order("created_at", { ascending: false });

    if (reports) {
      for (const r of reports) {
        const sid = r.session_id as string;
        if (!reportBySession[sid]) {
          reportBySession[sid] = {
            summary: r.summary as string,
            overall_score: r.overall_score as number | null,
          };
        }
      }
    }
  }

  const { data: memoryFull } = await supabase
    .from("user_memory")
    .select("weaknesses, patterns, total_sessions")
    .eq("user_id", userId)
    .maybeSingle();

  const enriched: EnrichedSession[] = list.map((s) => {
    const rep = reportBySession[s.id];
    const firstSentence = rep?.summary
      ? rep.summary.split(/(?<=[.!?])\s+/)[0]?.trim() || rep.summary
      : null;
    return {
      ...s,
      notes_preview: firstSentence,
      confidence: rep?.overall_score ?? null,
    };
  });

  type SessionThread = {
    id: string;
    head: EnrichedSession;
    headTokens: Set<string>;
    attempts: number;
  };

  const threads: SessionThread[] = [];

  for (const session of enriched) {
    const sessionText = session.context || session.notes_preview || "";
    const sessionTokens = toTokenSet(sessionText);
    const sessionEnded = session.ended_at ? new Date(session.ended_at).getTime() : Date.now();

    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < threads.length; i += 1) {
      const t = threads[i];
      const headEnded = t.head.ended_at ? new Date(t.head.ended_at).getTime() : Date.now();
      const hoursApart = Math.abs(sessionEnded - headEnded) / (1000 * 60 * 60);

      const exactContextMatch =
        toKeyText(session.context) &&
        toKeyText(session.context) === toKeyText(t.head.context);

      const score = exactContextMatch ? 1 : similarity(sessionTokens, t.headTokens);
      const closeEnough = hoursApart <= 72;

      if (closeEnough && score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestScore >= 0.28) {
      threads[bestIdx].attempts += 1;
      continue;
    }

    threads.push({
      id: session.id,
      head: session,
      headTokens: sessionTokens,
      attempts: 1,
    });
  }

  const threaded = threads.map((t) => ({
    ...t.head,
    thread_id: t.id,
    thread_attempts: t.attempts,
  }));

  return NextResponse.json({
    sessions: threaded,
    cap,
    pattern:
      memoryFull && (memoryFull.total_sessions ?? 0) >= 3
        ? {
            weakness:
              memoryFull.weaknesses?.[0] ||
              memoryFull.patterns?.[0] ||
              "finding direct wording under pressure",
            total_sessions: memoryFull.total_sessions,
          }
        : null,
  });
}
