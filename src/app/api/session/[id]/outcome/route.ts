import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { sessionBelongsToUser } from "@/lib/session-access";
import { NextResponse } from "next/server";

/** Aligned with notes UI: check-in available 1h after session (real convo may be same day) */
const MS_AFTER_SESSION = 60 * 60 * 1000;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    outcome?: string;
    user_note?: string | null;
  };
  const outcome = body.outcome === "well" || body.outcome === "tough" ? body.outcome : null;
  if (!outcome) {
    return NextResponse.json(
      { error: "Invalid outcome. Use \"well\" or \"tough\"." },
      { status: 400 }
    );
  }

  const note =
    typeof body.user_note === "string" && body.user_note.trim().length > 0
      ? body.user_note.trim().slice(0, 8000)
      : null;

  const supabase = createSupabaseAdmin();
  const ok = await sessionBelongsToUser(supabase, sessionId, userId);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: sessionRow, error: sessionErr } = await supabase
    .from("sessions")
    .select("created_at")
    .eq("id", sessionId)
    .single();

  if (sessionErr || !sessionRow?.created_at) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const created = new Date(sessionRow.created_at as string).getTime();
  if (Number.isNaN(created) || Date.now() - created < MS_AFTER_SESSION) {
    return NextResponse.json(
      {
        error:
          "Check-in unlocks about an hour after this session so you can report on the real conversation.",
      },
      { status: 400 }
    );
  }

  const { error: insertErr } = await supabase.from("session_outcomes").insert({
    session_id: sessionId,
    outcome,
    user_note: note,
  });

  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json({ success: true, duplicate: true });
    }
    console.error("[session_outcomes insert]", insertErr);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
