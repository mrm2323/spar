import OpenAI from "openai";
import { createSupabaseAdmin } from "@/lib/supabase/server";

function getOpenAIClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

async function fetchTranscriptFromVapi(
  callId: string
): Promise<unknown | null> {
  try {
    const res = await fetch(`https://api.vapi.ai/call/${callId}`, {
      headers: {
        Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}`,
      },
    });

    if (!res.ok) {
      console.log(
        "[NOTES] Vapi API returned",
        res.status,
        "for call",
        callId
      );
      return null;
    }

    const data = await res.json();

    // Vapi stores structured messages in artifact.messages, plain text in artifact.transcript
    const transcript =
      data.artifact?.messages ||
      data.artifact?.transcript ||
      data.transcript ||
      null;

    if (transcript) {
      console.log("[NOTES] Got transcript from Vapi API for call", callId);
    } else {
      console.log(
        "[NOTES] Vapi API response has no transcript yet for call",
        callId,
        "— status:",
        data.status
      );
    }

    return transcript;
  } catch (err) {
    console.error("[NOTES] Vapi API fetch failed:", err);
    return null;
  }
}

const NOTES_PROMPT = `You are Kabir. You just finished sparring with someone. You were the other person in their conversation. Now you're writing your notes.

You write like a scout who was watching film. Not a coach giving feedback. Not empty praise. Someone who saw exactly what happened and is telling them the truth in plain language.

The difference between your notes and ChatGPT's notes:
- ChatGPT: "You did well expressing your feelings. Consider being more specific next time."
- You: "You said 'I just think maybe we should talk.' Eight words to avoid saying 'I'm moving out.' The real conversation will punish you for that. Say the real thing first. Explain second."

Output JSON in this exact format:
{
  "overall_score": <0-100>,
  "summary": "<2-3 sentences. Direct, specific, useful. What actually happened in this session. Like a scouting report, not a pep talk. Example: 'You came in wanting to ask for a raise. You spent the first two minutes apologizing for asking. By the time you said the number, it sounded like a question. The version of you that showed up at minute four — direct, clear, no hedging — is the one to bring into the real meeting.'>",
  "what_worked": "<Quote their EXACT words from the transcript that worked. Put the quote in quotation marks. Then say why in one sentence — cold, specific. Example: 'You said: \"I've been here two years and I've taken on three roles that aren't in my job description.\" That's a fact, not a feeling. Facts are harder to argue with. Lead with that.'>",
  "what_to_rethink": "<Quote their EXACT words from the transcript that were weak. Be blunt. Example: 'You said: \"I guess I was just wondering if maybe there was any possibility of...\" You used 14 words before you got to the point. The other person checked out by word five. Say what you want. Then stop talking.'>",
  "next_time": "<One specific instruction for the real conversation. Not advice. An instruction. Something they can literally say. Reference their exact situation. Example: 'When you sit down with your manager, the first sentence out of your mouth should be: \"I want to discuss my compensation.\" Not \"I was hoping we could talk about...\" Not \"I know this is awkward but...\" The first sentence. Then wait. Let them respond. You practiced this — you know what comes next.'>"
}

Rules:
- 70+ means ready. 50-69 means getting there. Below 50 means go again.
- ALWAYS quote their exact words from the transcript. Every section must contain a direct quote. This is non-negotiable.
- Write like someone who was watching, not someone who was chatting.
- No fluff encouragement. Keep it concrete: what happened, why it worked/didn't, and exactly what to do next.
- Be specific about WHAT they said, WHEN they said it, and WHY it did or didn't work.`;

export async function generateKabirNotes(
  sessionId: string,
  userId: string
): Promise<{ notes: Record<string, unknown>; fromCache: boolean } | null> {
  const supabase = createSupabaseAdmin();

  // Check for existing report — use limit(1) to handle possible duplicates gracefully
  const { data: existing } = await supabase
    .from("forensics_reports")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    console.log("[NOTES] Found existing report for session:", sessionId);
    return {
      notes: existing.moments as Record<string, unknown>,
      fromCache: true,
    };
  }

  const { data: session } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (!session) {
    console.log("[NOTES] Session not found:", sessionId);
    return null;
  }

  let transcript = session.transcript;

  // PRIMARY FIX: If no transcript in DB, fetch directly from Vapi REST API
  if (!transcript && session.vapi_call_id) {
    console.log(
      "[NOTES] No transcript in DB, fetching from Vapi API for call:",
      session.vapi_call_id
    );
    transcript = await fetchTranscriptFromVapi(session.vapi_call_id);

    if (transcript) {
      await supabase
        .from("sessions")
        .update({ transcript })
        .eq("id", sessionId);
      console.log("[NOTES] Saved Vapi transcript to DB for session:", sessionId);
    }
  }

  if (!transcript) {
    console.log("[NOTES] No transcript available for session:", sessionId);
    return null;
  }

  const openai = getOpenAIClient();

  try {
    const transcriptText =
      typeof transcript === "string" ? transcript : JSON.stringify(transcript);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: NOTES_PROMPT },
        {
          role: "user",
          content: `Context they shared before the call: ${session.context || "none"}\n\nFull transcript of the practice session:\n${transcriptText}`,
        },
      ],
    });

    const notes = JSON.parse(completion.choices[0].message.content || "{}");
    console.log(
      "[NOTES] Generated notes for session:",
      sessionId,
      "score:",
      notes.overall_score
    );

    // Clamp score to valid range to prevent constraint violation
    const score = Math.min(100, Math.max(0, Number(notes.overall_score) || 50));

    const { error } = await supabase.from("forensics_reports").insert({
      session_id: sessionId,
      user_id: userId,
      overall_score: score,
      summary: notes.summary || "Kabir reviewed your session.",
      moments: notes,
    });

    if (error) {
      console.error("[NOTES] DB insert error:", error.message, error.code);
      // Still return the notes even if DB save fails — the client can display them
    }

    return { notes, fromCache: false };
  } catch (err) {
    console.error("[NOTES] OpenAI generation failed:", err);
    return null;
  }
}

const MEMORY_PROMPT = `You are updating Kabir's memory about this user. Based on this session transcript, write a concise memory update (max 200 words) that captures:

- What conversation type they practiced
- Their primary communication weakness in this session
- Their primary strength
- Any patterns you notice (especially if this is a repeat behavior)
- Their emotional state and confidence level
- Anything personal they mentioned (upcoming dates, relationships, job situation, names, timelines)

Write this as notes Kabir would keep about someone he's sparring with. Direct. Factual. No fluff. No encouragement. Just what happened and what to remember for next time.

If previous memory is provided, reference it to identify PATTERNS — things that keep showing up across sessions. Call those out explicitly.

Output plain text, not JSON. No bullet points or headers. Just a tight paragraph.`;

export async function generateMemoryUpdate(
  sessionId: string,
  userId: string
): Promise<void> {
  if (userId.startsWith("phone:")) return;

  const supabase = createSupabaseAdmin();

  const { data: session } = await supabase
    .from("sessions")
    .select("transcript, context")
    .eq("id", sessionId)
    .single();

  if (!session?.transcript) {
    console.log("[MEMORY] No transcript for session:", sessionId);
    return;
  }

  const { data: existingMemory } = await supabase
    .from("user_memory")
    .select("kabir_memory")
    .eq("user_id", userId)
    .single();

  const previousMemory = existingMemory?.kabir_memory || "";

  const openai = getOpenAIClient();

  try {
    const transcriptText =
      typeof session.transcript === "string"
        ? session.transcript
        : JSON.stringify(session.transcript);

    const messages: { role: "system" | "user"; content: string }[] = [
      { role: "system", content: MEMORY_PROMPT },
      {
        role: "user",
        content: [
          previousMemory
            ? `Previous memory about this user:\n${previousMemory}\n\n---\n`
            : "",
          `Context they shared: ${session.context || "none"}`,
          `\nTranscript:\n${transcriptText}`,
        ].join(""),
      },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 300,
    });

    const update = completion.choices[0].message.content?.trim();
    if (!update) return;

    const date = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const entry = `--- Session: ${date} ---\n${update}`;
    const newMemory = previousMemory
      ? `${entry}\n\n${previousMemory}`
      : entry;

    // Trim to prevent unbounded growth (keep ~last 10 sessions worth)
    const trimmed =
      newMemory.length > 8000 ? newMemory.slice(0, 8000) : newMemory;

    if (existingMemory) {
      await supabase
        .from("user_memory")
        .update({
          kabir_memory: trimmed,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    } else {
      await supabase.from("user_memory").insert({
        user_id: userId,
        kabir_memory: trimmed,
        total_sessions: 1,
      });
    }

    console.log(
      "[MEMORY] Updated memory for user:",
      userId,
      "length:",
      trimmed.length
    );
  } catch (err) {
    console.error("[MEMORY] Generation failed:", err);
  }
}
