import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId, vapiCallId } = (await req.json()) as {
      sessionId: string;
      vapiCallId?: string | null;
    };
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const supabase = createSupabaseAdmin();

    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("id, user_id, status, started_at, vapi_call_id")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();

    if (sessionError) {
      console.error("[SESSION END] fetch session failed", sessionError);
      return NextResponse.json(
        { error: "Could not load session" },
        { status: 500 }
      );
    }

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const endedAtIso = new Date().toISOString();
    const startedMs = session.started_at ? Date.parse(session.started_at) : NaN;
    const durationSeconds = Number.isFinite(startedMs)
      ? Math.max(0, Math.round((Date.now() - startedMs) / 1000))
      : null;

    const updateData: Record<string, unknown> = {
      status: "completed",
      ended_at: endedAtIso,
    };

    if (durationSeconds !== null) {
      updateData.duration_seconds = durationSeconds;
    }

    // Save vapiCallId if provided and not already set (backup in case PATCH failed)
    if (vapiCallId && !session.vapi_call_id) {
      updateData.vapi_call_id = vapiCallId;
    }

    const { error: updateError } = await supabase
      .from("sessions")
      .update(updateData)
      .eq("id", sessionId)
      .eq("user_id", userId);

    if (updateError) {
      console.error("[SESSION END] update failed", updateError);
      return NextResponse.json(
        { error: "Failed to end session" },
        { status: 500 }
      );
    }

    // Memory accounting should not block ending the session.
    const { data: existingMemory, error: memoryFetchError } = await supabase
      .from("user_memory")
      .select("total_sessions")
      .eq("user_id", userId)
      .maybeSingle();

    if (memoryFetchError) {
      console.error("[SESSION END] memory fetch failed", memoryFetchError);
      return NextResponse.json({ success: true, warning: "memory_sync_failed" });
    }

    if (existingMemory) {
      const { error: memoryUpdateError } = await supabase
        .from("user_memory")
        .update({
          total_sessions: existingMemory.total_sessions + 1,
          last_session_at: endedAtIso,
          updated_at: endedAtIso,
        })
        .eq("user_id", userId);

      if (memoryUpdateError) {
        console.error("[SESSION END] memory update failed", memoryUpdateError);
      }
    } else {
      const { error: memoryInsertError } = await supabase
        .from("user_memory")
        .insert({
          user_id: userId,
          total_sessions: 1,
          last_session_at: endedAtIso,
        });

      if (memoryInsertError) {
        console.error("[SESSION END] memory insert failed", memoryInsertError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[SESSION END] unexpected error", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
