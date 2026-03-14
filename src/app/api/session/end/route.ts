import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
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

  const { data: session } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const endedAt = new Date();
  const startedAt = new Date(session.started_at);
  const durationSeconds = Math.round(
    (endedAt.getTime() - startedAt.getTime()) / 1000
  );

  const updateData: Record<string, unknown> = {
    status: "completed",
    ended_at: endedAt.toISOString(),
    duration_seconds: durationSeconds,
  };

  // Save vapiCallId if provided and not already set (backup in case PATCH failed)
  if (vapiCallId && !session.vapi_call_id) {
    updateData.vapi_call_id = vapiCallId;
  }

  await supabase.from("sessions").update(updateData).eq("id", sessionId);

  const { data: existingMemory } = await supabase
    .from("user_memory")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (existingMemory) {
    await supabase
      .from("user_memory")
      .update({
        total_sessions: existingMemory.total_sessions + 1,
        last_session_at: endedAt.toISOString(),
        updated_at: endedAt.toISOString(),
      })
      .eq("user_id", userId);
  } else {
    await supabase.from("user_memory").insert({
      user_id: userId,
      total_sessions: 1,
      last_session_at: endedAt.toISOString(),
    });
  }

  return NextResponse.json({ success: true });
}
