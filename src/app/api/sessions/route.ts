import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ sessions: [] });
  }

  const supabase = createSupabaseAdmin();

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

  const enriched = list.map((s) => {
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

  return NextResponse.json({
    sessions: enriched,
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
