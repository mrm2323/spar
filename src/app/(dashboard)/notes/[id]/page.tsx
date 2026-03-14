import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { NotesClient } from "./notes-client";

export default async function NotesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return null;

  const supabase = createSupabaseAdmin();

  // Use limit(1) + maybeSingle to handle possible duplicates gracefully
  const { data: report } = await supabase
    .from("forensics_reports")
    .select("*")
    .eq("session_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <NotesClient
      sessionId={id}
      initialNotes={
        report ? (report.moments as Record<string, unknown>) : null
      }
      initialDate={report?.created_at || null}
    />
  );
}
