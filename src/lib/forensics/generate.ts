import OpenAI from "openai";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import {
  formatKabirNotesForMemory,
  hasSupermemory,
  saveSessionMemory,
  searchMemory,
  upsertOverallProfileMemory,
} from "@/lib/kabir/memory";

function getOpenAIClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

async function generateAndUpsertOverallProfile(
  userId: string,
  notes: Record<string, unknown>,
  transcriptText: string
): Promise<void> {
  if (!hasSupermemory() || !process.env.OPENAI_API_KEY) return;

  let prior = "";
  try {
    const hits = await searchMemory(userId, "KABIR_RUNNING_PROFILE");
    prior = hits[0]?.slice(0, 3500) ?? "";
  } catch {
    /* noop */
  }

  const notesText = formatKabirNotesForMemory(notes);
  const tail = transcriptText.length > 4000 ? transcriptText.slice(-4000) : transcriptText;

  const openai = getOpenAIClient();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You maintain ONE running paragraph Kabir uses to "know" this person across sessions.
Output a single paragraph (max 200 words). No bullets. No greeting. Third person ("they").
Cover: what they're preparing for, emotional baseline, recurring weaknesses/strengths, concrete progress.
Merge PRIOR SNAPSHOT with NEW SESSION; prefer the newest facts when they conflict.`,
        },
        {
          role: "user",
          content: `PRIOR SNAPSHOT (may be empty):\n${prior || "(none)"}\n\nNEW SESSION NOTES:\n${notesText}\n\nRECENT TRANSCRIPT TAIL:\n${tail}`,
        },
      ],
      max_tokens: 450,
    });

    const paragraph = completion.choices[0].message.content?.trim();
    if (paragraph) {
      await upsertOverallProfileMemory(userId, paragraph);
    }
  } catch (e) {
    console.error("[OVERALL PROFILE] generation failed:", e);
  }
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

    await saveSessionMemory(
      userId,
      sessionId,
      transcriptText,
      formatKabirNotesForMemory(notes as Record<string, unknown>)
    );

    await generateAndUpsertOverallProfile(
      userId,
      notes as Record<string, unknown>,
      transcriptText
    );

    return { notes, fromCache: false };
  } catch (err) {
    console.error("[NOTES] OpenAI generation failed:", err);
    return null;
  }
}
