import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { getUserSessionUsage } from "@/lib/session-cap";
import { groupSessionsIntoThreads } from "@/lib/session-threading";
import { NextResponse } from "next/server";

type EnrichedSession = {
  id: string;
  context: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  user_id: string;
  notes_preview: string | null;
};

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
    { summary: string; kabirTake?: string | null }
  > = {};

  if (sessionIds.length > 0) {
    const { data: reports } = await supabase
      .from("forensics_reports")
      .select("session_id, summary, moments, created_at")
      .in("session_id", sessionIds)
      .order("created_at", { ascending: false });

    if (reports) {
      for (const r of reports) {
        const sid = r.session_id as string;
        if (!reportBySession[sid]) {
          const moments = r.moments as Record<string, unknown> | null | undefined;
          const kabirTake =
            moments && typeof moments.kabirTake === "string"
              ? (moments.kabirTake as string)
              : null;
          reportBySession[sid] = {
            summary: kabirTake || (r.summary as string),
            kabirTake,
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
    const source = rep?.kabirTake || rep?.summary || "";
    let firstSentence: string | null = null;
    if (source) {
      const end = source.search(/[.!?](\s|$)/);
      firstSentence =
        end === -1
          ? source.trim().slice(0, 220)
          : source.slice(0, end + 1).trim();
    }
    return {
      ...s,
      notes_preview: firstSentence,
    };
  });

  const threads = groupSessionsIntoThreads(enriched, {
    maxHoursApart: 72,
    minSimilarity: 0.28,
  });

  const threaded = threads.map((t) => ({
    ...t.head,
    thread_id: t.id,
    thread_attempts: t.attempts,
    thread_session_ids: t.sessions.map((s) => s.id),
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
