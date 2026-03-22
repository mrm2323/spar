import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { buildFullKabirContext } from "@/lib/kabir/memory";
import {
  buildResumeContextForPrompt,
  defaultResumeFirstMessage,
} from "@/lib/kabir/resume-context";
import { buildKabirPrompt } from "@/lib/kabir/system-prompt";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { context, resumeSessionId, mode, referenceSessionId } = body as {
      context?: string | null;
      resumeSessionId?: string | null;
      mode?: "new" | "continue" | "restart";
      referenceSessionId?: string | null;
    };

    const effectiveMode = mode || "new";
    const effectiveResumeSessionId =
      resumeSessionId ||
      (effectiveMode === "continue" ? referenceSessionId || null : null);

    let effectiveContext = context || null;

    const supabase = createSupabaseAdmin();

    if (effectiveMode === "restart" && referenceSessionId && !effectiveContext) {
      const { data: referenceSession } = await supabase
        .from("sessions")
        .select("context")
        .eq("id", referenceSessionId)
        .eq("user_id", userId)
        .maybeSingle();

      if (!referenceSession) {
        return NextResponse.json(
          { error: "Could not load session to restart" },
          { status: 400 }
        );
      }

      effectiveContext = referenceSession.context || null;
    }

    let resumeBlock: string | null = null;
    if (effectiveResumeSessionId) {
      resumeBlock = await buildResumeContextForPrompt(
        effectiveResumeSessionId,
        userId
      );
      if (!resumeBlock) {
        return NextResponse.json(
          { error: "Could not load session to resume" },
          { status: 400 }
        );
      }
    }

    const memoryText = await buildFullKabirContext(userId, supabase, {
      resumeSessionId: effectiveResumeSessionId,
    });

    const systemPrompt = buildKabirPrompt({
      scenarioRaw: effectiveContext || undefined,
      channel: "web",
      durationSeconds: 600,
      userMemory: memoryText.trim() ? memoryText : undefined,
      resumeContext: resumeBlock || undefined,
    });

    const { data: session, error } = await supabase
      .from("sessions")
      .insert({
        user_id: userId,
        scenario: "high_stakes",
        context: effectiveContext,
        status: "active",
      })
      .select("id")
      .single();

    if (error || !session) {
      console.error("Session insert failed:", error);
      return NextResponse.json(
        { error: "Failed to create session", details: error?.message },
        { status: 500 }
      );
    }

    const hasHistory = memoryText.trim().length > 40;

    return NextResponse.json({
      sessionId: session.id,
      systemPrompt,
      firstMessage: effectiveMode === "restart"
        ? "Hey. Let's run this from the top. Give me your opening line when you're ready."
        : effectiveResumeSessionId
        ? defaultResumeFirstMessage()
        : hasHistory
          ? "Hey — it's Kabir. I'm with you. What's the conversation today?"
          : "Hey. It's Kabir. What conversation are you looking forward to?",
    });
  } catch (err) {
    console.error("Session start error:", err);
    return NextResponse.json(
      { error: "Internal error", details: String(err) },
      { status: 500 }
    );
  }
}
