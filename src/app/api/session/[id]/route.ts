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
    appendTranscriptEntry?: {
      role?: string;
      content?: string;
      source?: string;
      time?: string;
    };
  };

  const supabase = createSupabaseAdmin();
  const ok = await sessionBelongsToUser(supabase, sessionId, userId);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const appendContext = body.appendContext?.trim() || "";
  const appendTranscriptContent = body.appendTranscriptEntry?.content?.trim() || "";

  if (!body.vapiCallId && !appendContext && !appendTranscriptContent) {
    return NextResponse.json(
      { error: "Provide vapiCallId and/or appendContext and/or appendTranscriptEntry" },
      { status: 400 }
    );
  }

  const patchData: Record<string, unknown> = {};

  if (appendContext || appendTranscriptContent) {
    const { data: row } = await supabase
      .from("sessions")
      .select("context, transcript")
      .eq("id", sessionId)
      .maybeSingle();

    if (appendContext) {
      const prev = typeof row?.context === "string" ? row.context.trim() : "";
      patchData.context = prev
        ? `${prev}\n\n--- Additional context (during session) ---\n${appendContext}`
        : appendContext;
    }

    if (appendTranscriptContent) {
      const existingRaw = row?.transcript;
      let existingTranscript: Array<Record<string, unknown>> = [];

      if (Array.isArray(existingRaw)) {
        existingTranscript = existingRaw.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item)
        );
      } else if (typeof existingRaw === "string") {
        try {
          const parsed = JSON.parse(existingRaw) as unknown;
          if (Array.isArray(parsed)) {
            existingTranscript = parsed.filter(
              (item): item is Record<string, unknown> =>
                Boolean(item) && typeof item === "object" && !Array.isArray(item)
            );
          }
        } catch {
          existingTranscript = [];
        }
      }

      existingTranscript.push({
        role: body.appendTranscriptEntry?.role || "user",
        content: appendTranscriptContent,
        source: body.appendTranscriptEntry?.source || "typed",
        time: body.appendTranscriptEntry?.time || new Date().toISOString(),
      });

      patchData.transcript = existingTranscript.slice(-600);
    }
  }

  if (body.vapiCallId) {
    patchData.vapi_call_id = body.vapiCallId;
  }

  if (Object.keys(patchData).length > 0) {
    await supabase.from("sessions").update(patchData).eq("id", sessionId);
  }

  return NextResponse.json({ success: true });
}
