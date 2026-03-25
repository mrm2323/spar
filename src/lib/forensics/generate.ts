import OpenAI from "openai";
import { createSupabaseAdmin } from "@/lib/supabase/server";
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

2c. Action items must reference specific details.
BAD: 'Prepare what you want to say.'
GOOD: 'Text Sarah today and say you want to talk this weekend. Don't ambush her after work. She needs time to not feel cornered.'

2d. If the conversation was too short to gather meaningful context, say that honestly in readiness, e.g.:
'I did not get to ask you enough about the situation. Next time give me 5 minutes before we start practicing. The more I know about who you are talking to and what is really going on, the better I can help.'

3. keyHighlights — Up to 5 strings. Each ONE sentence. Specific facts or insights they might miss — names, dates, products, agendas. BAD: "The CEO wants to meet." GOOD: "Brendan mentioned a product launching in April and said you could get immediately involved — that is the real agenda, not the class visit."

4. actionItems — Up to 5 strings. SPECIFIC actions before their real conversation. Start each with a verb. Include names, dates, topics from the conversation or shared context. BAD: "Research the company." GOOD: "Read the pitch deck he attached. Find one thing in the investor Q&A you can ask about Tuesday."

5. If the user discussed a specific person, include "aboutThem" with what Kabir inferred about the other person's likely perspective, possible motivations, and how they might receive the conversation. This helps the user walk in with empathy, not just strategy.

6. whatWorked — { "quote": "exact strong user words", "why": "one sentence" }. whatToRethink — same shape for words that need work.

7. beforeYouWalkIn — One specific opening line or approach for the real conversation from actual details they shared. Never generic. Never placeholders.

8. readiness — One to two sentences. Kabir's honest gut read. NOT a score. Plain language only.

Rules for readiness (pick what fits; paraphrase if needed; never numbers):
- Ready: 'You are ready. You said what you needed to say and you said it clearly. Go do it. Call me after.'
- Partial: 'Your opening is solid. But when I pushed back you softened everything. Practice the pushback once more before you go in.'
- Not ready: 'Honestly, not yet. You are still circling around the thing you need to say instead of saying it. Call me back. We will get there.'
- Too short: 'I did not hear enough to tell you. Give me 5 minutes next time and I will give you a real answer.'

9. patternDetected — Optional string. Only if a communication pattern was clearly visible. Otherwise omit or empty string.

10. wordPattern: USER lines only. fillerCount > 0 ⇒ topFillers = actual words. hedgeCount > 0 ⇒ hedgePhrases exact from their lines.

11. Never use coaching clichés: 'great step', 'remember the goal is', 'key shift'. Never generic excited-opportunity openings.

FORMAT YOUR RESPONSE AS JSON ONLY:
{
  "kabirTake": "string",
  "keyHighlights": ["string"],
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

  const rawKh = out.keyHighlights;
  out.keyHighlights = Array.isArray(rawKh)
    ? rawKh
        .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
        .map((x) => x.trim())
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

  if (typeof out.aboutThem === "string") {
    const t = out.aboutThem.trim();
    if (t) out.aboutThem = t;
    else delete out.aboutThem;
  } else {
    delete out.aboutThem;
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
          content: `CONTEXT THEY SHARED BEFORE THE CALL (email, JD, message, paste — read carefully, extract facts for keyHighlights and actionItems):
${session.context && String(session.context).trim() ? String(session.context).trim() : "none"}

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
