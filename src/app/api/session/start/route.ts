import { auth, clerkClient } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { buildFullKabirContext, getPeopleContext } from "@/lib/kabir/memory";
import {
  buildResumeContextForPrompt,
  defaultResumeFirstMessage,
} from "@/lib/kabir/resume-context";
import { buildKabirPrompt } from "@/lib/kabir/system-prompt";
import { getMemoryPreference } from "@/lib/memory/preferences";
import {
  buildSituationFirstMessage,
  parseSituationMarker,
} from "@/lib/context-presets";
import {
  formatRemainingTime,
  getAllowedSessionSeconds,
  getUserSessionUsage,
} from "@/lib/session-cap";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      context,
      contextText,
      resumeSessionId,
      mode,
      referenceSessionId,
      situationPreset: situationPresetBody,
    } = body as {
      context?: string | null;
      /** Pasted email, JD, etc. — also stored in session row via merged `context` */
      contextText?: string | null;
      resumeSessionId?: string | null;
      mode?: "new" | "continue" | "restart";
      referenceSessionId?: string | null;
      /** Dashboard chip: Elevator pitch, etc. — not shown as bracket text in UI */
      situationPreset?: string | null;
    };

    const effectiveMode = mode || "new";
    const effectiveResumeSessionId =
      resumeSessionId ||
      (effectiveMode === "continue" ? referenceSessionId || null : null);

    const pastedBlock =
      typeof contextText === "string" ? contextText.trim() : "";
    const legacyContext =
      typeof context === "string" ? context.trim() : "";
    const situationPresetRaw =
      typeof situationPresetBody === "string"
        ? situationPresetBody.trim()
        : "";

    /** Stored on session row; prefer explicit contextText (paste + files from client), else legacy `context`. */
    let effectiveContext: string | null =
      pastedBlock || legacyContext || null;
    if (situationPresetRaw) {
      const line = `Situation: ${situationPresetRaw}`;
      effectiveContext = effectiveContext
        ? `${line}\n\n${effectiveContext}`
        : line;
    }

    const situationLabel =
      situationPresetRaw ||
      parseSituationMarker(pastedBlock) ||
      parseSituationMarker(legacyContext) ||
      null;

    const supabase = createSupabaseAdmin();

    const usage = await getUserSessionUsage(supabase, userId, {
      includeActive: true,
    });
    const allowedSessionSeconds = getAllowedSessionSeconds(usage.remainingSeconds);

    if (allowedSessionSeconds <= 0) {
      return NextResponse.json(
        {
          error: "You have reached your current 15-minute practice cap.",
          code: "SESSION_MINUTE_CAP_REACHED",
          message:
            "You have completed your 15 free practice minutes. Thank you for practicing with Kabir.",
          cap: usage,
        },
        { status: 403 }
      );
    }

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

    let userFirstName: string | undefined;
    try {
      const client = await clerkClient();
      const clerkUser = await client.users.getUser(userId);
      const n = clerkUser.firstName?.trim();
      userFirstName = n || undefined;
    } catch (e) {
      console.warn("[session/start] Could not load Clerk name:", e);
    }

    const memoryEnabled = await getMemoryPreference(userId);
    let memoryText = "";
    let peopleContext = "";
    if (memoryEnabled) {
      console.log("Fetching memory for user:", userId);
      [memoryText, peopleContext] = await Promise.all([
        buildFullKabirContext(userId, supabase, {
          resumeSessionId: effectiveResumeSessionId,
        }),
        getPeopleContext(userId),
      ]);
      console.log("Memory retrieved, length:", memoryText.length);
      console.log("Memory content preview:", memoryText.substring(0, 200));
    }

    const systemPrompt = buildKabirPrompt({
      scenarioRaw: undefined,
      contextText: effectiveContext || undefined,
      situationPreset:
        situationLabel && !effectiveResumeSessionId && effectiveMode !== "restart"
          ? situationLabel
          : undefined,
      channel: "web",
      durationSeconds: allowedSessionSeconds,
      userName: userFirstName,
      userMemory: memoryText.trim() ? memoryText : undefined,
      peopleContext: peopleContext.trim() ? peopleContext : undefined,
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

    const hasHistory = memoryEnabled && memoryText.trim().length > 40;

    const name = userFirstName;
    let firstMessage: string;
    if (effectiveMode === "restart") {
      firstMessage = name
        ? `Hey ${name} — let's run this from the top. Give me your opening line when you're ready.`
        : "Hey. Let's run this from the top. Give me your opening line when you're ready.";
    } else if (effectiveResumeSessionId) {
      firstMessage = defaultResumeFirstMessage(name);
    } else if (situationLabel) {
      firstMessage = buildSituationFirstMessage(situationLabel, name);
    } else if (hasHistory) {
      firstMessage = name
        ? `Hey ${name} — it's Kabir. I'm with you. What's the conversation today?`
        : "Hey — it's Kabir. I'm with you. What's the conversation today?";
    } else {
      firstMessage = name
        ? `Hey, ${name}. It's Kabir. I'm really glad you're here. What conversation are you looking forward to?`
        : "Hey. It's Kabir. I'm really glad you're here. What conversation are you looking forward to?";
    }

    const sessionTimeMessage = usage.capExempt
      ? "Unlimited practice on your account today."
      : `You have ${formatRemainingTime(usage.remainingSeconds)} left in your free practice bank.`;

    return NextResponse.json({
      sessionId: session.id,
      systemPrompt,
      maxDurationSeconds: allowedSessionSeconds,
      cap: {
        ...usage,
        sessionSecondsAllocated: allowedSessionSeconds,
        sessionTimeMessage,
      },
      firstMessage,
    });
  } catch (err) {
    console.error("Session start error:", err);
    return NextResponse.json(
      { error: "Internal error", details: String(err) },
      { status: 500 }
    );
  }
}
