import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { sessionBelongsToUser } from "@/lib/session-access";
import { NotesClient } from "./notes-client";
import { redirect } from "next/navigation";

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
    .select("duration_seconds, transcript, ended_at, started_at, created_at")
    .eq("id", id)
    .single();

  const { data: existingOutcome } = await supabase
    .from("session_outcomes")
    .select("id")
    .eq("session_id", id)
    .maybeSingle();

  return (
    <NotesClient
      sessionId={id}
      initialNotes={
        report ? (report.moments as Record<string, unknown>) : null
      }
      initialDate={report?.created_at || null}
      overallScore={
        typeof report?.overall_score === "number"
          ? report.overall_score
          : null
      }
      initialSession={
        session
          ? {
              duration_seconds: session.duration_seconds,
              transcript: session.transcript,
              ended_at: session.ended_at,
            }
          : null
      }
      sessionCreatedAt={
        session?.created_at ? String(session.created_at) : null
      }
      initialOutcomeSubmitted={!!existingOutcome}
    />
  );
}
