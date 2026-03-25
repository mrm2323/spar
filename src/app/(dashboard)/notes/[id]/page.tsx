import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { sessionBelongsToUser } from "@/lib/session-access";
import { groupSessionsIntoThreads } from "@/lib/session-threading";
import { NotesClient } from "./notes-client";
import { redirect } from "next/navigation";

type TranscriptRow = {
  role: string;
  content: string;
  time?: string | undefined;
  source?: string | undefined;
};

function normalizeTranscriptRows(transcript: unknown): TranscriptRow[] {
  if (Array.isArray(transcript)) {
    const rows: TranscriptRow[] = [];
    for (const row of transcript) {
      const item = row as Record<string, unknown>;
      const role =
        typeof item.role === "string"
          ? item.role
          : typeof item.speaker === "string"
            ? item.speaker
            : "";
      const content =
        typeof item.content === "string"
          ? item.content
          : typeof item.message === "string"
            ? item.message
            : typeof item.text === "string"
              ? item.text
              : "";
      const trimmed = content.trim();
      if (!trimmed) continue;
      rows.push({
        role: role || "unknown",
        content: trimmed,
        time: typeof item.time === "string" ? item.time : undefined,
        source: typeof item.source === "string" ? item.source : undefined,
      });
    }
    return rows;
  }
  if (typeof transcript === "string") {
    try {
      const parsed = JSON.parse(transcript) as unknown;
      return normalizeTranscriptRows(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

export default async function NotesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const supabase = createSupabaseAdmin();
  const allowed = await sessionBelongsToUser(supabase, id, userId);
  if (!allowed) redirect("/dashboard");

  const { data: report } = await supabase
    .from("forensics_reports")
    .select("*")
    .eq("session_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: session } = await supabase
    .from("sessions")
    .select("id, user_id, transcript, context, ended_at, started_at, created_at, duration_seconds")
    .eq("id", id)
    .single();

  const activeUserIds = [userId];
  const { data: memoryRow } = await supabase
    .from("user_memory")
    .select("phone_number")
    .eq("user_id", userId)
    .maybeSingle();
  if (memoryRow?.phone_number) {
    activeUserIds.push(`phone:${memoryRow.phone_number}`);
  }

  const { data: recentSessions } = await supabase
    .from("sessions")
    .select("id, user_id, context, transcript, ended_at, duration_seconds")
    .in("user_id", activeUserIds)
    .eq("status", "completed")
    .order("ended_at", { ascending: false })
    .limit(40);

  let threadAttempts = 1;
  let mergedTranscript: TranscriptRow[] = normalizeTranscriptRows(session?.transcript);

  if (Array.isArray(recentSessions) && recentSessions.length > 0) {
    const threads = groupSessionsIntoThreads(
      recentSessions.map((s) => ({
        id: s.id,
        context: s.context,
        ended_at: s.ended_at,
      })),
      { maxHoursApart: 72, minSimilarity: 0.28 }
    );

    const currentThread = threads.find((t) => t.sessions.some((s) => s.id === id));
    if (currentThread) {
      threadAttempts = currentThread.attempts;
      const byId = new Map(recentSessions.map((s) => [s.id, s]));
      const ordered = currentThread.sessions
        .map((s) => byId.get(s.id))
        .filter((s): s is NonNullable<typeof recentSessions>[number] => Boolean(s))
        .sort((a, b) => {
          const ta = a.ended_at ? new Date(a.ended_at).getTime() : 0;
          const tb = b.ended_at ? new Date(b.ended_at).getTime() : 0;
          return ta - tb;
        });

      const nextRows: TranscriptRow[] = [];
      for (let i = 0; i < ordered.length; i += 1) {
        const s = ordered[i];
        const when = s.ended_at
          ? new Date(s.ended_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })
          : "recent";
        nextRows.push({
          role: "system",
          content: `Attempt ${i + 1} (${when})`,
          source: "attempt_marker",
        });
        const contextText = typeof s.context === "string" ? s.context.trim() : "";
        if (contextText) {
          nextRows.push({
            role: "user",
            content: `[Context for this attempt]\n${contextText.slice(0, 1500)}`,
            source: "attempt_context",
          });
        }
        nextRows.push(...normalizeTranscriptRows(s.transcript));
      }

      if (nextRows.length > 0) {
        mergedTranscript = nextRows.slice(-1200);
      }
    }
  }

  const { data: existingOutcome } = await supabase
    .from("session_outcomes")
    .select("id")
    .eq("session_id", id)
    .maybeSingle();

  const { count: completedSessionsCount } = await supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "completed");

  return (
    <NotesClient
      sessionId={id}
      initialNotes={
        report ? (report.moments as Record<string, unknown>) : null
      }
      initialDate={report?.created_at || null}
      initialSession={
        session
          ? {
              transcript: mergedTranscript,
              ended_at: session.ended_at,
              duration_seconds: session.duration_seconds,
            }
          : null
      }
      initialThreadAttempts={threadAttempts}
      initialOutcomeSubmitted={!!existingOutcome}
      completedSessionsCount={completedSessionsCount || 0}
    />
  );
}
