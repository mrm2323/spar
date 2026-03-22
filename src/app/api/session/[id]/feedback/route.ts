import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { sessionBelongsToUser } from "@/lib/session-access";
import {
  parseSessionFeedbackInput,
  upsertSessionFeedback,
} from "@/lib/session-feedback";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const parsed = parseSessionFeedbackInput(body);

  if (!parsed.value) {
    return NextResponse.json(
      { error: parsed.error || "Invalid payload" },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdmin();
  const ok = await sessionBelongsToUser(supabase, sessionId, userId);

  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await upsertSessionFeedback({
    supabase,
    sessionId,
    userId,
    feedback: parsed.value,
  });

  if (error) {
    console.error("[session_feedback upsert]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
