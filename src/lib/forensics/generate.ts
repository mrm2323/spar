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

const NOTES_PROMPT = `You are Kabir writing notes to someone you just practiced a conversation with. You have their transcript below. Your notes must feel like they came from someone who was LISTENING.

ABSOLUTE RULES:

1. kabirTake must quote the user's EXACT words from the transcript (in quotes). Then explain what those words reveal.

2. Never use generic advice. Tie everything to this specific conversation.

3. Never use coaching clichés: 'great step', 'remember the goal is', 'key shift', 'next move'.

4. Never suggest openings that start with "I'm excited about this opportunity."

5. If the session was short (under 3 minutes), do NOT apologize. Still fill every JSON field: estimate wordPattern from what you heard; give a readinessScore in 40-95 based on what little you heard; set timestamps like "near the start".

6. readinessScore must be an integer from 40 to 95 (inclusive) when you have enough signal. If SESSION_DURATION_SECONDS is less than 180, still output a number 40-95 from what you heard, OR use null only if impossible.

7. readinessLabel must be exactly one of: "Not ready yet" | "Getting there" | "Almost" | "You're ready" — align with the score (lower score → "Not ready yet", high → "You're ready").

8. strongestMoment and weakestMoment: quote must be exact user words; timestamp is a short phrase like "near the start" or "2 minutes in".

9. actionItems: exactly 3 strings (or fewer if transcript is tiny). Direct instructions ("Do X"), not vague advice.

10. wordPattern: estimate counts from the USER's lines only. topFillers and hedgePhrases are short strings. If no fillers, fillerCount 0 and topFillers []. Same for hedges and apologies.

11. beforeYouWalkIn: one concrete sentence using their details. Never the generic excited-opportunity line.

FORMAT YOUR RESPONSE AS JSON ONLY:
{
  "kabirTake": "string",
  "readinessScore": 40-95 or null,
  "readinessLabel": "Not ready yet" | "Getting there" | "Almost" | "You're ready",
  "strongestMoment": { "quote": "string", "timestamp": "string", "why": "string" },
  "weakestMoment": { "quote": "string", "timestamp": "string", "why": "string" },
  "actionItems": ["string", "string", "string"],
  "wordPattern": {
    "fillerCount": 0,
    "topFillers": ["um", "like"],
    "hedgeCount": 0,
    "hedgePhrases": ["I guess"],
    "apologyCount": 0
  },
  "beforeYouWalkIn": "string"
}

Output valid JSON only. No markdown.`;

function asMoment(
  raw: unknown,
  legacy: { quote?: string; why?: string } | null
): { quote: string; timestamp: string; why: string } {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    return {
      quote: typeof o.quote === "string" ? o.quote.trim() : "",
      timestamp: typeof o.timestamp === "string" ? o.timestamp.trim() : "",
      why: typeof o.why === "string" ? o.why.trim() : "",
    };
  }
  if (legacy?.quote || legacy?.why) {
    return {
      quote: legacy.quote || "",
      timestamp: "",
      why: legacy.why || "",
    };
  }
  return { quote: "", timestamp: "", why: "" };
}

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

  const rs = out.readinessScore;
  if (rs === null || rs === undefined || rs === "") {
    out.readinessScore = null;
  } else {
    const n = Number(rs);
    out.readinessScore = Number.isFinite(n)
      ? Math.min(95, Math.max(40, Math.round(n)))
      : null;
  }

  const allowed = new Set([
    "Not ready yet",
    "Getting there",
    "Almost",
    "You're ready",
  ]);
  if (typeof out.readinessLabel !== "string" || !allowed.has(out.readinessLabel)) {
    const score = out.readinessScore as number | null;
    if (score != null) {
      if (score < 50) out.readinessLabel = "Not ready yet";
      else if (score < 70) out.readinessLabel = "Getting there";
      else if (score < 85) out.readinessLabel = "Almost";
      else out.readinessLabel = "You're ready";
    } else {
      out.readinessLabel = "Getting there";
    }
  }

  const legacyWw = out.whatWorked as Record<string, unknown> | undefined;
  const legacyWr = out.whatToRethink as Record<string, unknown> | undefined;
  if (!out.strongestMoment) {
    out.strongestMoment = asMoment(null, {
      quote: typeof legacyWw?.quote === "string" ? legacyWw.quote : undefined,
      why: typeof legacyWw?.why === "string" ? legacyWw.why : undefined,
    });
  } else {
    const m = asMoment(out.strongestMoment, null);
    if (!m.quote && legacyWw?.quote) m.quote = String(legacyWw.quote);
    if (!m.why && legacyWw?.why) m.why = String(legacyWw.why);
    out.strongestMoment = m;
  }

  if (!out.weakestMoment) {
    out.weakestMoment = asMoment(null, {
      quote: typeof legacyWr?.quote === "string" ? legacyWr.quote : undefined,
      why: typeof legacyWr?.why === "string" ? legacyWr.why : undefined,
    });
  } else {
    const m = asMoment(out.weakestMoment, null);
    if (!m.quote && legacyWr?.quote) m.quote = String(legacyWr.quote);
    if (!m.why && legacyWr?.why) m.why = String(legacyWr.why);
    out.weakestMoment = m;
  }

  const rawItems = out.actionItems;
  const itemsList = Array.isArray(rawItems) ? rawItems : [];
  out.actionItems = itemsList
    .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
    .map((x) => x.trim())
    .slice(0, 5);

  let wp = out.wordPattern;
  if (!wp || typeof wp !== "object" || Array.isArray(wp)) {
    wp = {};
  }
  const wpo = wp as Record<string, unknown>;
  out.wordPattern = {
    fillerCount: Math.max(
      0,
      Math.round(Number(wpo.fillerCount) || 0)
    ),
    topFillers: Array.isArray(wpo.topFillers)
      ? wpo.topFillers.filter((x) => typeof x === "string").map(String)
      : [],
    hedgeCount: Math.max(0, Math.round(Number(wpo.hedgeCount) || 0)),
    hedgePhrases: Array.isArray(wpo.hedgePhrases)
      ? wpo.hedgePhrases.filter((x) => typeof x === "string").map(String)
      : [],
    apologyCount: Math.max(0, Math.round(Number(wpo.apologyCount) || 0)),
  };

  if (
    typeof out.beforeYouWalkIn !== "string" ||
    !out.beforeYouWalkIn.trim()
  ) {
    const alt =
      typeof out.next_time === "string" ? out.next_time.trim() : "";
    if (alt) out.beforeYouWalkIn = alt;
  }

  return out;
}

export async function generateKabirNotes(
  sessionId: string,
  userId: string
): Promise<{ notes: Record<string, unknown>; fromCache: boolean } | null> {
  const supabase = createSupabaseAdmin();

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
      max_tokens: 2800,
    });

    const parsed = JSON.parse(
      completion.choices[0].message.content || "{}"
    ) as Record<string, unknown>;
    const notes = normalizeKabirNotesOutput(parsed);

    const readiness = notes.readinessScore;
    const overallForDb =
      typeof readiness === "number"
        ? readiness
        : typeof notes.overall_score === "number"
          ? notes.overall_score
          : null;
    notes.overall_score =
      overallForDb != null && Number.isFinite(overallForDb)
        ? Math.min(100, Math.max(0, Math.round(Number(overallForDb))))
        : null;

    console.log(
      "[NOTES] Generated notes for session:",
      sessionId,
      "readiness:",
      notes.readinessScore,
      "overall_score:",
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
