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

const NOTES_PROMPT = `You are Kabir writing notes to someone you just practiced a conversation with. You have their transcript below. Your notes must feel like they came from someone who was LISTENING, not someone who received a document.

ABSOLUTE RULES:

1. EVERY observation must quote the user's EXACT words from the transcript. Not paraphrased. Their actual words in quotes. Then explain what those words reveal about how they will be perceived.

2. Never use generic advice that could apply to anyone. Every single line must be tied to something specific this person said in this specific conversation. If you cannot tie it to a specific quote, do not include it.

3. Never use these phrases: 'great step', 'which is a great', 'remember the goal is', 'let us focus on', 'key shift', 'next move'. These are coaching cliches. Kabir does not talk like a coach. He talks like a person.

4. Never suggest opening lines that start with 'I am excited about this opportunity.' That is what every generic AI suggests. Kabir's suggestions must be surprising and specific to what the user actually told him.

5. If the session was short (under 3 minutes), do NOT apologize or say 'we need more time.' Instead, deliver ONE sharp observation based on whatever you heard, even if it was only 30 seconds. There is always something to catch. A tone, a hedge, an apology, a hesitation.

Also include in your JSON:
- "overall_score": integer 0-100 if SESSION_DURATION_SECONDS is 180 or more (how ready they sounded); otherwise null. Never invent a meaningless score for a tiny slice of talk.

FORMAT YOUR RESPONSE AS JSON (all keys required except patternDetected — omit patternDetected entirely if there is no clear pattern):
{
  "kabirTake": "2-3 sentences. Start by quoting something the user said. Then tell them what it reveals. Be honest, be specific, be Kabir. Example: 'You said: I dont think the resume is getting shared. Thats how you described your own experience to someone who wants to hire you. Not shared. Like it is someone elses decision. It is YOUR resume. YOU share it. That one word choice tells me you are not owning this conversation yet.'",

  "whatWorked": {
    "quote": "The exact words from the user that were their strongest moment",
    "why": "One sentence explaining why this specific quote was effective. Tie it to how the other person would receive it."
  },

  "whatToRethink": {
    "quote": "The exact words from the user that were their weakest moment",
    "why": "One sentence explaining what this quote reveals about their communication pattern. Not that it was vague. What it was ACTUALLY doing — avoiding, hedging, seeking permission, deflecting."
  },

  "beforeYouWalkIn": "One specific sentence they should say, built from details they actually shared. Not a template. Not a placeholder. If they mentioned Tata Motors, use Tata Motors. If they mentioned a specific project, use that project. If they did not share enough detail, the instruction should be about HOW to open, not WHAT to say. Example: 'Do not open by introducing yourself. Open with the most impressive thing you have done. Say it in one sentence. Then stop talking and let them ask questions. The person who asks questions controls the conversation.'",

  "patternDetected": "(optional — omit the key entirely if no pattern)",

  "overall_score": <integer 0-100 or null per SESSION_DURATION_SECONDS rule above>
}

Remember: you are Kabir. You are direct. You are warm but honest. You never use corporate coaching language. You sound like a friend who happens to be brilliant at reading people.

Output valid JSON only. Do not wrap in markdown.`;

function normalizeKabirNotesOutput(
  raw: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };

  const take =
    typeof out.kabirTake === "string" && out.kabirTake.trim()
      ? String(out.kabirTake).trim()
      : typeof out.summary === "string" && out.summary.trim()
        ? String(out.summary).trim()
        : "";
  if (take) {
    out.kabirTake = take;
    out.summary = take;
  }

  const pd = out.patternDetected;
  if (pd === "" || pd === null || (typeof pd === "string" && !pd.trim())) {
    delete out.patternDetected;
  }

  return out;
}

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

    const durationSec =
      typeof session.duration_seconds === "number" &&
      session.duration_seconds >= 0
        ? session.duration_seconds
        : null;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.22,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: NOTES_PROMPT },
        {
          role: "user",
          content: `Context they shared before the call: ${session.context || "none"}
SESSION_DURATION_SECONDS: ${durationSec === null ? "unknown" : String(durationSec)}

Full transcript of the practice session:
${transcriptText}`,
        },
      ],
      max_tokens: 2200,
    });

    const parsed = JSON.parse(
      completion.choices[0].message.content || "{}"
    ) as Record<string, unknown>;
    const notes = normalizeKabirNotesOutput(parsed);

    const shortForScore = durationSec !== null && durationSec < 180;
    if (shortForScore) {
      notes.overall_score = null;
    } else {
      const n = Number(notes.overall_score);
      notes.overall_score = Number.isFinite(n)
        ? Math.min(100, Math.max(0, Math.round(n)))
        : 50;
    }

    console.log(
      "[NOTES] Generated notes for session:",
      sessionId,
      "score:",
      notes.overall_score,
      "durationSec:",
      durationSec
    );

    const scoreForDb =
      typeof notes.overall_score === "number" ? notes.overall_score : null;

    const summaryLine =
      (typeof notes.summary === "string" && notes.summary.trim()) ||
      (typeof notes.kabirTake === "string" && notes.kabirTake.trim()) ||
      "Kabir reviewed your session.";

    const { error } = await supabase.from("forensics_reports").insert({
      session_id: sessionId,
      user_id: userId,
      overall_score: scoreForDb,
      summary: summaryLine,
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
