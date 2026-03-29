import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { hasSupermemory } from "@/lib/kabir/memory";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export type MemoryTimelineItem = {
  id: string;
  date: string | null;
  context: string;
  summary: string;
};

/**
 * Practice history for “what kabir knows”: completed sessions + notes summary line.
 * Works without Supermemory (Supabase-only).
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdmin();

  const { data: sessions, error: sessErr } = await supabase
    .from("sessions")
    .select("id, context, ended_at, created_at")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("ended_at", { ascending: false })
    .limit(40);

  if (sessErr) {
    console.error("[memory/history] sessions", sessErr);
    return NextResponse.json(
      { error: "Could not load sessions" },
      { status: 500 }
    );
  }

  const list = sessions ?? [];
  const ids = list.map((s) => s.id);

  let reports: {
    session_id: string;
    summary: string | null;
    moments: unknown;
  }[] = [];

  if (ids.length > 0) {
    const { data: repData, error: repErr } = await supabase
      .from("forensics_reports")
      .select("session_id, summary, moments")
      .in("session_id", ids);

    if (repErr) {
      console.error("[memory/history] reports", repErr);
    } else {
      reports = repData ?? [];
    }
  }

  const reportBySession = new Map(reports.map((r) => [r.session_id, r]));

  const timeline: MemoryTimelineItem[] = list.map((s) => {
    const r = reportBySession.get(s.id);
    const moments = r?.moments as Record<string, unknown> | undefined;
    const sum =
      (typeof moments?.kabirTake === "string" && moments.kabirTake) ||
      (typeof moments?.summary === "string" && moments.summary) ||
      (typeof r?.summary === "string" && r.summary) ||
      "";
    return {
      id: s.id,
      date: (s.ended_at as string | null) ?? (s.created_at as string | null),
      context: ((s.context ?? "") as string).slice(0, 400),
      summary: sum.trim().slice(0, 800),
    };
  });

  return NextResponse.json({
    timeline,
    supermemoryConfigured: hasSupermemory(),
  });
}
