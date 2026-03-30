import OpenAI from "openai";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { sessionBelongsToUser } from "@/lib/session-access";
import {
  formatKabirNotesForMemory,
  hasSupermemory,
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
      data.messages ||
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

export type SessionTranscriptRow = {
  id: string;
  transcript: unknown;
  vapi_call_id: string | null;
};

/** True when there is nothing useful to show or send to the model. */
function transcriptLooksEmpty(transcript: unknown): boolean {
  if (transcript == null) return true;
  if (Array.isArray(transcript)) return transcript.length === 0;
  if (typeof transcript === "string") return !transcript.trim();
  if (typeof transcript === "object") return false;
  return true;
}

/**
 * If the session row has no transcript but we have a Vapi call id, pull from Vapi and persist.
 * Used by notes generation and the notes page so "Full conversation" is not empty when the webhook was late or missed.
 */
export async function hydrateTranscriptIfMissing(
  row: SessionTranscriptRow
): Promise<unknown> {
  if (!transcriptLooksEmpty(row.transcript)) return row.transcript;
  const callId =
    typeof row.vapi_call_id === "string" ? row.vapi_call_id.trim() : "";
  if (!callId) return row.transcript;

  const t = await fetchTranscriptFromVapi(callId);
  if (!t || transcriptLooksEmpty(t)) return row.transcript;

  const supabase = createSupabaseAdmin();
  await supabase.from("sessions").update({ transcript: t }).eq("id", row.id);
  console.log("[NOTES] Hydrated transcript from Vapi for session:", row.id);
  return t;
}

const NOTES_PROMPT = `You are Kabir writing notes to someone you just practiced a conversation with. You have their transcript below and may have CONTEXT they shared before the call (email, JD, message). Your notes must feel like a personal briefing from someone who READ everything, LISTENED, and is telling them exactly what to do next — not a report card.

ABSOLUTE RULES:

1. kabirTake — 2-3 sentences. Kabir's honest read on the situation from the conversation AND any context they shared. Quote their exact words from the transcript (in quotes). Be specific. Name subtext (e.g. what a CEO's phrasing actually signals).

2. When they shared context (email, job description, message), your notes must show you READ and UNDERSTOOD it. Extract key facts. Identify what the other person is asking for or signaling. Translate subtext into plain language.

2b. When generating notes, use ALL context from the conversation including:
- Details the user shared about the other person (name, personality, relationship)
- Details about the user themselves (how they handle conflict, their fears)
- The specific situation and what triggered it
- What the user wants to achieve from the conversation
Every note should demonstrate that you understood the FULL picture, not just the words they practiced.
BAD: 'You were vague when describing the problem.'
GOOD: 'You told me Sarah gets quiet when she is upset. But your opening line — telling her everything that is wrong — is going to trigger exactly that. She will shut down before you get to what you actually want. Start with what you want for the relationship, not what is broken.'

2d. If the conversation was too short to gather meaningful context, say that honestly in readiness, e.g.:
'I did not get to ask you enough about the situation. Next time give me 5 minutes before we start practicing. The more I know about who you are talking to and what is really going on, the better I can help.'

3. anticipatedQuestions — EXACTLY 2 to 3 objects.

Before you write them: pull 3 CONCRETE anchors from the transcript (names, class or event title, format of the session, example topic they chose, audience, fear they said out loud, phrase Kabir used). You will prove you used the transcript.

REQUIRED FRAMING (follow exactly):
"Based on the conversation, predict 2-3 specific questions the other person will likely ask in the real conversation. For each, write the exact words the user should say in response. Not advice about what to say. The literal sentence they should speak. Be specific to this situation."

For EACH object:
- "question": Must sound like something THIS evaluator / counterpart would ask given what was practiced — include at least one anchor (the class, the rubric, the scenario, or a detail they said). Banned: generic interview filler that could apply to any job ("tell me about yourself" unless the transcript was literally about that).
- "answer": The EXACT WORDS out of their mouth — one or two short sentences max. MUST reuse specific language from the transcript (the topic they nailed, the structure of the class, the story they told). 
BAD answer (too generic): "I'm aiming to showcase both clarity and confidence in my communication." / "I'll focus on articulating my thoughts clearly regardless of the topic."
GOOD answer (grounded): "For my five-minute piece I'm using the story about the ER waiting room — it hits the 'stakes + resolution' rubric we talked about." (uses their example + rubric from session)
BAD question: "What specific skills are you hoping to demonstrate?"
GOOD question: "Why did you pick that example for the impromptu round instead of something from work?" (only if the transcript was about choosing an example)

If the transcript is rich and you still output generic Q&A, you failed the task. Rewrite until each line could only apply to THIS session.
Other rules: NOT "you could try...", NOT "Say:", NOT meta-instructions — only spoken words.
If the scenario is too thin to predict, still give 2 best-effort scenario-specific questions; do not use filler like "How are you?"

4. actionItems — Up to 5 strings. Each must cite something CONCRETE from the transcript or shared context (a name, a number, a topic, a document, a fear they named). Generic coaching is forbidden.
BAD: "Clarify the main problem."
GOOD: "Write one sentence that explains what happens when international students freeze in interviews. Practice saying it out loud in under 10 seconds."

5. aboutThem — Only if the user gave enough specific detail about the other person (role, relationship, behavior, stakes) to infer something grounded. Write empathy + how they might receive the conversation using THOSE details.
If they did NOT give enough detail, set aboutThem to EXACTLY: "I don't know enough about who you're meeting. Before your next session, tell me about them and I'll help you read the room."
Do not invent a generic personality sketch when facts are missing.

6. whatWorked — { "quote": "exact strong user words", "why": "one sentence" }. whatToRethink — same shape for words that need work.

7. beforeYouWalkIn — Must be a COMPLETE sentence or two the user can literally say out loud. NEVER end with ellipsis, "...", trailing "by...", or template junk like "dive into the unique solution." Give actual words. If you lack specifics, give a tight STRUCTURE they can follow in complete sentences, e.g. "Open with the problem in one sentence. State the number that proves it. Then stop and let them respond." That is better than a half-finished template.

8. readiness — One to two sentences. Kabir's honest gut read. NOT a score. Plain language only.

Rules for readiness (pick what fits; paraphrase if needed; never numbers):
- Ready: 'You are ready. You said what you needed to say and you said it clearly. Go do it. Call me after.'
- Partial: 'Your opening is solid. But when I pushed back you softened everything. Practice the pushback once more before you go in.'
- Not ready: 'Honestly, not yet. You are still circling around the thing you need to say instead of saying it. Call me back. We will get there.'
- Too short: 'I did not hear enough to tell you. Give me 5 minutes next time and I will give you a real answer.'

9. patternDetected — Optional string. Only if a communication pattern was clearly visible. Otherwise omit or empty string.

10. wordPattern: USER lines only. fillerCount > 0 ⇒ topFillers = actual words. hedgeCount > 0 ⇒ hedgePhrases exact from their lines.

11. Never use coaching clichés: 'great step', 'remember the goal is', 'key shift'. Never generic excited-opportunity openings.

12. When the transcript has real back-and-forth (roughly a minute or more of practice), you MUST include at least 2 anticipatedQuestions entries and at least 2 actionItems unless rule 2d applies (too short / no substance).

FORMAT YOUR RESPONSE AS JSON ONLY:
{
  "kabirTake": "string",
  "anticipatedQuestions": [
    { "question": "string", "answer": "string" }
  ],
  "actionItems": ["string"],
  "aboutThem": "string",
  "whatWorked": { "quote": "string", "why": "string" },
  "whatToRethink": { "quote": "string", "why": "string" },
  "beforeYouWalkIn": "string",
  "readiness": "string",
  "patternDetected": "string",
  "wordPattern": {
    "fillerCount": 0,
    "topFillers": [],
    "hedgeCount": 0,
    "hedgePhrases": [],
    "apologyCount": 0
  }
}

Output valid JSON only. No markdown.`;

const ABOUT_THEM_FALLBACK =
  "I don't know enough about who you're meeting. Before your next session, tell me about them and I'll help you read the room.";

/** Strip trailing ellipsis, broken tails, and obvious template crud from opening lines. */
function sanitizeBeforeYouWalkIn(raw: string): string {
  let s = raw.trim();
  if (!s) return s;
  s = s.replace(/\u2026+/g, "…");
  s = s.replace(/\s*…+\s*$/u, ".").replace(/\s*\.{3,}\s*$/u, ".");
  s = s.replace(/\s+by\.{0,3}\s*$/i, ".");
  s = s.replace(/\s+(and|or)\s*$/i, ".");
  const lower = s.toLowerCase();
  if (
    /dive into the unique solution|leverage synergies|circle back|touch base/i.test(
      lower
    )
  ) {
    return (
      "Open with the problem in one clear sentence. Give one concrete fact or number from your situation. " +
      "Stop talking and let them respond."
    );
  }
  if (!/[.!?]"?\s*$/.test(s) && s.length > 80) {
    s = `${s.trimEnd()}.`;
  }
  return s.trim();
}

/** Remove meta prefixes the model sometimes adds instead of literal spoken lines. */
function sanitizeSpokenLine(raw: string): string {
  let s = raw.trim();
  if (!s) return s;
  s = s.replace(
    /^(you (could|should|might|can|want to) (try )?(to )?|try (to )?|say:\s*|tell them:\s*|your line:\s*|response:\s*)/i,
    ""
  );
  s = s.replace(/^(the user should say:\s*)/i, "");
  return s.replace(/^["']|["']$/g, "").trim();
}

/** Generic empathy blobs with no anchor from the user — replace with honest fallback. */
function aboutThemLooksUnmoored(text: string, transcriptSample: string): boolean {
  const t = text.trim();
  if (t.length < 24) return false;
  const lower = t.toLowerCase();
  const sample = transcriptSample.toLowerCase();
  const hasNameLike =
    /\b([A-Z][a-z]{2,15})\b/.test(text) ||
    /\b(manager|professor|roommate|partner|boss|interviewer|recruiter|ceo|client|hr|human resources|landlord|advisor|dean)\b/i.test(
      sample
    );
  const vaguePhrases =
    /they (may|might|will probably)|likely to (feel|react)|in general|people often|typically they/i.test(
      lower
    );
  if (vaguePhrases && !hasNameLike) return true;
  if (t.length > 120 && !hasNameLike && /they (are|'re) /i.test(lower)) return true;
  return false;
}

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

export type NormalizeNotesOptions = {
  /** Used to detect generic aboutThem when the transcript has no real detail about the other person. */
  transcriptSample?: string;
};

function normalizeKabirNotesOutput(
  raw: Record<string, unknown>,
  opts?: NormalizeNotesOptions
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

  let readinessStr =
    typeof out.readiness === "string" ? out.readiness.trim() : "";
  if (!readinessStr) {
    readinessStr =
      "I did not hear enough to tell you. Give me 5 minutes next time and I will give you a real answer.";
  }
  out.readiness = readinessStr;

  delete out.readinessScore;
  delete out.readinessLabel;
  delete out.overall_score;
  delete out.scoreSuppressedReason;

  delete out.keyHighlights;

  const rawAq = out.anticipatedQuestions;
  out.anticipatedQuestions = Array.isArray(rawAq)
    ? rawAq
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          const o = item as Record<string, unknown>;
          const question =
            typeof o.question === "string" ? o.question.trim() : "";
          let answer =
            typeof o.answer === "string" ? sanitizeSpokenLine(o.answer) : "";
          if (!question || !answer) return null;
          return { question, answer };
        })
        .filter((x): x is { question: string; answer: string } => Boolean(x))
        .slice(0, 5)
    : [];

  const legacyWw = out.whatWorked as Record<string, unknown> | undefined;
  const legacyWr = out.whatToRethink as Record<string, unknown> | undefined;

  if (legacyWw && typeof legacyWw === "object" && !Array.isArray(legacyWw)) {
    out.strongestMoment = asMoment(legacyWw, null);
  } else if (!out.strongestMoment) {
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

  if (legacyWr && typeof legacyWr === "object" && !Array.isArray(legacyWr)) {
    out.weakestMoment = asMoment(legacyWr, null);
  } else if (!out.weakestMoment) {
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

  if (typeof out.patternDetected === "string") {
    out.patternDetected = out.patternDetected.trim();
  } else {
    out.patternDetected = "";
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

  if (typeof out.beforeYouWalkIn === "string" && out.beforeYouWalkIn.trim()) {
    out.beforeYouWalkIn = sanitizeBeforeYouWalkIn(String(out.beforeYouWalkIn));
  }

  if (typeof out.aboutThem === "string") {
    let t = out.aboutThem.trim();
    if (t) {
      const sample = opts?.transcriptSample ?? "";
      if (sample && aboutThemLooksUnmoored(t, sample)) {
        t = ABOUT_THEM_FALLBACK;
      }
      out.aboutThem = t;
    } else delete out.aboutThem;
  } else {
    delete out.aboutThem;
  }

  return out;
}

export type GenerateKabirNotesOptions = {
  /** Delete cached report and run GPT again (same transcript). */
  forceRegenerate?: boolean;
};

export async function generateKabirNotes(
  sessionId: string,
  userId: string,
  options?: GenerateKabirNotesOptions
): Promise<{ notes: Record<string, unknown>; fromCache: boolean } | null> {
  const supabase = createSupabaseAdmin();

  if (options?.forceRegenerate) {
    const allowed = await sessionBelongsToUser(supabase, sessionId, userId);
    if (!allowed) {
      console.warn("[NOTES] regenerate denied — session not owned:", sessionId);
      return null;
    }
  } else {
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

  const transcript = await hydrateTranscriptIfMissing({
    id: session.id,
    transcript: session.transcript,
    vapi_call_id: session.vapi_call_id ?? null,
  });

  if (transcriptLooksEmpty(transcript)) {
    console.log("[NOTES] No transcript available for session:", sessionId);
    return null;
  }

  if (options?.forceRegenerate) {
    const { error: delErr } = await supabase
      .from("forensics_reports")
      .delete()
      .eq("session_id", sessionId);
    if (delErr) {
      console.error("[NOTES] forensics delete for regenerate:", delErr.message);
    }
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
      temperature: 0.18,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: NOTES_PROMPT },
        {
          role: "user",
          content: `CONTEXT THEY SHARED BEFORE THE CALL (email, JD, message, paste — read carefully, extract facts for actionItems and scenario-specific anticipatedQuestions):
${session.context && String(session.context).trim() ? String(session.context).trim() : "none"}

SESSION_DURATION_SECONDS: ${durationSec === null ? "unknown" : String(durationSec)}

Full transcript of the practice session:
${transcriptText}`,
        },
      ],
      max_tokens: 3200,
    });

    const parsed = JSON.parse(
      completion.choices[0].message.content || "{}"
    ) as Record<string, unknown>;
    const notes = normalizeKabirNotesOutput(parsed, {
      transcriptSample: transcriptText.slice(0, 14_000),
    });

    console.log(
      "[NOTES] Generated notes for session:",
      sessionId,
      "readiness:",
      String(notes.readiness).slice(0, 120),
      "durationSec:",
      durationSec
    );

    const summaryLine =
      (typeof notes.summary === "string" && notes.summary.trim()) ||
      (typeof notes.kabirTake === "string" && notes.kabirTake.trim()) ||
      "Kabir reviewed your session.";

    const { error } = await supabase.from("forensics_reports").insert({
      session_id: sessionId,
      user_id: userId,
      overall_score: null,
      summary: summaryLine,
      moments: notes,
    });

    if (error) {
      console.error("[NOTES] DB insert error:", error.message, error.code);
    }

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
