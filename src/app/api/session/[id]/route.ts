import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { sessionBelongsToUser } from "@/lib/session-access";
import { NextResponse } from "next/server";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdmin();
  const ok = await sessionBelongsToUser(supabase, sessionId, userId);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await supabase.from("sessions").delete().eq("id", sessionId);
  if (error) {
    console.error("[SESSION DELETE]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdmin();
  const ok = await sessionBelongsToUser(supabase, sessionId, userId);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: session, error } = await supabase
    .from("sessions")
    .select(
      "id, context, status, started_at, ended_at, duration_seconds, transcript, user_id"
    )
    .eq("id", sessionId)
    .single();

  if (error || !session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ session });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    vapiCallId?: string;
    /** Appended to session.context for notes generation (mid-session paste; not injected into live Vapi). */
    appendContext?: string;
  };

  const supabase = createSupabaseAdmin();
  const ok = await sessionBelongsToUser(supabase, sessionId, userId);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (body.appendContext?.trim()) {
    const { data: row } = await supabase
      .from("sessions")
      .select("context")
      .eq("id", sessionId)
      .maybeSingle();

    const prev = typeof row?.context === "string" ? row.context.trim() : "";
    const add = body.appendContext.trim();
    const next = prev
      ? `${prev}\n\n--- Additional context (during session) ---\n${add}`
      : add;

    await supabase.from("sessions").update({ context: next }).eq("id", sessionId);
  }

  if (body.vapiCallId) {
    await supabase
      .from("sessions")
      .update({ vapi_call_id: body.vapiCallId })
      .eq("id", sessionId);
  }

  if (!body.vapiCallId && !body.appendContext?.trim()) {
    return NextResponse.json(
      { error: "Provide vapiCallId and/or appendContext" },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true });
}
