import { after } from "next/server";
import OpenAI from "openai";
import { clerkClient } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { generateKabirNotes } from "@/lib/forensics/generate";
import {
  analyzePatterns,
  buildFullKabirContext,
  formatKabirNotesForMemory,
  getPeopleContext,
  hasSupermemory,
  savePersonProfile,
  saveSessionMemory,
} from "@/lib/kabir/memory";
import { buildKabirPrompt } from "@/lib/kabir/system-prompt";
import memoryService from "@/services/memory";
import { getMemoryPreference } from "@/lib/memory/preferences";
import {
  formatRemainingTime,
  getAllowedSessionSeconds,
  getUserSessionUsage,
} from "@/lib/session-cap";
import { NextResponse } from "next/server";

function shouldDropTranscriptMessage(content: string): boolean {
  const text = content.trim();
  if (!text) return true;

  // Vapi can include full system-prompt/config payload in artifact.messages.
  if (
    text.includes("You are Kabir.") ||
    text.includes("WHAT YOU KNOW ABOUT THIS PERSON") ||
    text.includes("HOW YOU HELP") ||
    text.includes("NEVER DO THESE THINGS") ||
    text.includes("CONTINUING WHERE YOU LEFT OFF")
  ) {
    return true;
  }

  // Filter non-conversational giant blobs.
  if (text.length > 2200 && (text.includes("========================") || text.includes("\\n- "))) {
    return true;
  }

  return false;
}

type SanitizedTranscriptRow = {
  role: string;
  content: string;
  time: unknown;
  endTime: unknown;
  secondsFromStart: unknown;
};

function sanitizeTranscript(transcript: unknown): unknown {
  if (!Array.isArray(transcript)) return transcript;

  const cleaned = transcript
    .map((row): SanitizedTranscriptRow | null => {
      const item = row as Record<string, unknown>;
      const role =
        typeof item.role === "string"
          ? item.role
          : typeof item.speaker === "string"
            ? item.speaker
            : "";
      const content =
        typeof item.message === "string"
          ? item.message
          : typeof item.content === "string"
            ? item.content
            : typeof item.text === "string"
              ? item.text
              : "";

      if (shouldDropTranscriptMessage(content)) return null;

      return {
        role,
        content,
        time: item.time,
        endTime: item.endTime,
        secondsFromStart: item.secondsFromStart,
      };
    })
    .filter((row): row is SanitizedTranscriptRow => row !== null);

  return cleaned;
}

function normalizeTranscriptForMerge(transcript: unknown): SanitizedTranscriptRow[] {
  if (Array.isArray(transcript)) {
    return transcript
      .map((row) => {
        const item = row as Record<string, unknown>;
        const role = typeof item.role === "string" ? item.role : "";
        const content =
          typeof item.content === "string"
            ? item.content
            : typeof item.message === "string"
              ? item.message
              : typeof item.text === "string"
                ? item.text
                : "";
        const trimmed = content.trim();
        if (!trimmed) return null;
        return {
          role,
          content: trimmed,
          time: item.time,
          endTime: item.endTime,
          secondsFromStart: item.secondsFromStart,
        };
      })
      .filter((row): row is SanitizedTranscriptRow => row !== null);
  }
  if (typeof transcript === "string") {
    try {
      const parsed = JSON.parse(transcript) as unknown;
      return normalizeTranscriptForMerge(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

function mergeTranscripts(existing: unknown, incoming: unknown): SanitizedTranscriptRow[] {
  const all = [
    ...normalizeTranscriptForMerge(existing),
    ...normalizeTranscriptForMerge(incoming),
  ];
  const seen = new Set<string>();
  const merged: SanitizedTranscriptRow[] = [];

  for (const row of all) {
    const key = `${row.role}::${row.content}::${String(row.time ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }

  return merged.slice(-1200);
}

function toMemoryMessages(transcript: unknown): Array<{ role: string; content: string }> {
  if (!Array.isArray(transcript)) return [];
  return transcript
    .map((m) => {
      const role = typeof m?.role === "string" ? m.role : "";
      const content =
        typeof m?.message === "string"
          ? m.message
          : typeof m?.content === "string"
            ? m.content
            : "";
      return { role, content };
    })
    .filter((m) => m.role && m.content);
}

async function resolveCanonicalUserId(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  userId: string
): Promise<string> {
  if (!userId.startsWith("phone:")) return userId;
  const phone = userId.replace("phone:", "");
  const { data: memoryRow } = await supabase
    .from("user_memory")
    .select("user_id")
    .eq("phone_number", phone)
    .maybeSingle();
  return memoryRow?.user_id || userId;
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  if (raw.trim().startsWith("+")) return raw.trim();
  return digits ? `+${digits}` : raw.trim();
}

async function extractPeopleProfiles(
  transcriptText: string
): Promise<
  Array<{
    name: string;
    traits: string;
    relationship: string;
    reactionStyle: string;
    history: string;
    positiveIntent: string;
  }>
> {
  if (!process.env.OPENAI_API_KEY?.trim()) return [];
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const peopleExtraction = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Analyze this conversation transcript. Extract information about any people the user mentioned (not Kabir). For each person, capture:
- Their name (or descriptor like "my roommate" or "my manager")
- Personality traits inferred from what the user described
- Relationship to the user
- How they typically react in difficult situations (if mentioned)
- History of interactions the user described
- Any positive intent that might explain their behavior

Return JSON object: { "people": [{ "name": string, "traits": string, "relationship": string, "reactionStyle": string, "history": string, "positiveIntent": string }] }
If no people were discussed in detail, return {"people":[]}.`,
      },
      {
        role: "user",
        content: transcriptText,
      },
    ],
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(
    peopleExtraction.choices[0]?.message?.content || '{"people":[]}'
  ) as {
    people?: Array<{
      name?: string;
      traits?: string;
      relationship?: string;
      reactionStyle?: string;
      history?: string;
      positiveIntent?: string;
    }>;
  };
  const people = Array.isArray(parsed.people) ? parsed.people : [];
  return people
    .map((p) => ({
      name: (p.name || "").trim(),
      traits: (p.traits || "").trim(),
      relationship: (p.relationship || "").trim(),
      reactionStyle: (p.reactionStyle || "").trim(),
      history: (p.history || "").trim(),
      positiveIntent: (p.positiveIntent || "").trim(),
    }))
    .filter((p) => p.name.length > 0);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { type } = body.message || body;

  console.log(
    `[VAPI WEBHOOK] type=${type}`,
    JSON.stringify(body).slice(0, 500)
  );

  const supabase = createSupabaseAdmin();

  switch (type) {
    case "assistant-request": {
      const call = body.message?.call || body.call;
      const phoneNumberRaw = call?.customer?.number;
      const phoneNumber = phoneNumberRaw
        ? normalizePhone(String(phoneNumberRaw))
        : null;
      console.log(
        "[VAPI WEBHOOK] assistant-request from phone:",
        phoneNumber || "web"
      );

      let resolvedUserId = phoneNumber ? `phone:${phoneNumber}` : "unknown";

      // Try to resolve phone number to a linked Clerk user
      if (phoneNumber) {
        const { data: memoryRow } = await supabase
          .from("user_memory")
          .select("*")
          .eq("phone_number", phoneNumber)
          .limit(1)
          .maybeSingle();

        if (memoryRow) {
          resolvedUserId = memoryRow.user_id;
          console.log(
            "[VAPI WEBHOOK] Resolved phone to user:",
            resolvedUserId
          );
        }
      }

      let memoryText = "";
      let peopleContext = "";
      try {
        const memoryOn = await getMemoryPreference(resolvedUserId);
        if (memoryOn) {
          [memoryText, peopleContext] = await Promise.all([
            buildFullKabirContext(resolvedUserId, supabase),
            getPeopleContext(resolvedUserId),
          ]);
        }
      } catch {
        [memoryText, peopleContext] = await Promise.all([
          buildFullKabirContext(resolvedUserId, supabase),
          getPeopleContext(resolvedUserId),
        ]);
      }

      const usage = await getUserSessionUsage(supabase, resolvedUserId, {
        includeActive: true,
      }).catch(() => null);
      const allowedSessionSeconds = usage
        ? getAllowedSessionSeconds(usage.remainingSeconds)
        : 600;
      const reachedCap = usage ? allowedSessionSeconds <= 0 : false;
      const effectiveDurationSeconds = reachedCap ? 45 : allowedSessionSeconds;

      let phoneUserFirstName: string | undefined;
      if (resolvedUserId.startsWith("user_")) {
        try {
          const c = await clerkClient();
          const u = await c.users.getUser(resolvedUserId);
          phoneUserFirstName = u.firstName?.trim() || undefined;
        } catch {
          /* noop */
        }
      }

      const systemPrompt = buildKabirPrompt({
        scenarioRaw: undefined,
        channel: "phone",
        durationSeconds: effectiveDurationSeconds,
        userName: phoneUserFirstName,
        userMemory: memoryText.trim() ? memoryText : undefined,
        peopleContext: peopleContext.trim() ? peopleContext : undefined,
      });

      if (phoneNumber && !reachedCap) {
        const { data: session } = await supabase
          .from("sessions")
          .insert({
            user_id: resolvedUserId,
            scenario: "high_stakes",
            context: null,
            status: "active",
            vapi_call_id: call?.id || null,
          })
          .select("id")
          .single();

        if (session) {
          console.log("[VAPI WEBHOOK] Phone session created:", session.id, "for user:", resolvedUserId);
        }
      }

      return NextResponse.json({
        assistant: {
          name: "Kabir",
          model: {
            provider: "openai",
            model: "gpt-4o",
            messages: [{ role: "system", content: systemPrompt }],
          },
          voice: {
            provider: "vapi",
            voiceId: "Rohan",
          },
          firstMessage: reachedCap
            ? `Hey, it is Kabir. You have completed your 15 free practice minutes for now. Thanks for showing up and putting in the work. Come back when your next practice window is available.`
            : usage
              ? phoneUserFirstName
                ? `Hey ${phoneUserFirstName}, it is Kabir. You have ${formatRemainingTime(usage.remainingSeconds)} left in your current practice bank. What conversation are you looking forward to?`
                : `Hey. It is Kabir. You have ${formatRemainingTime(usage.remainingSeconds)} left in your current practice bank. What conversation are you looking forward to?`
              : phoneUserFirstName
                ? `Hey ${phoneUserFirstName}. It's Kabir. I'm really glad you're here. What conversation are you looking forward to?`
                : "Hey. It's Kabir. What conversation are you looking forward to?",
          maxDurationSeconds: effectiveDurationSeconds,
          startSpeakingPlan: {
            waitSeconds: 1.0,
            smartEndpointingEnabled: true,
          },
          stopSpeakingPlan: {
            numWords: 2,
            voiceSeconds: 0.28,
            backoffSeconds: 1.8,
          },
        },
      });
    }

    case "end-of-call-report": {
      const msg = body.message || body;
      const call = msg.call;
      const callId = call?.id;

      // FIX: Vapi sends transcript inside artifact, not at top level
      const artifact = msg.artifact || {};
      const rawTranscript =
        artifact.messages || artifact.transcript || msg.transcript || null;
      const transcript = sanitizeTranscript(rawTranscript);
      const hasTranscript = Array.isArray(transcript)
        ? transcript.length > 0
        : typeof transcript === "string"
          ? transcript.trim().length > 0
          : false;

      console.log(
        `[VAPI WEBHOOK] end-of-call-report callId=${callId}, hasTranscript=${!!transcript}, hasArtifact=${!!msg.artifact}`
      );
      if (!callId) break;

      const { data: existingSession } = await supabase
        .from("sessions")
        .select("id, user_id, transcript")
        .eq("vapi_call_id", callId)
        .maybeSingle();

      let session =
        existingSession && existingSession.id
          ? { id: existingSession.id, user_id: existingSession.user_id }
          : null;

      const mergedTranscript = mergeTranscripts(
        existingSession?.transcript,
        transcript
      );

      if (existingSession?.id) {
        const { data: updatedSession } = await supabase
          .from("sessions")
          .update({ transcript: mergedTranscript })
          .eq("id", existingSession.id)
          .select("id, user_id")
          .single();
        session = updatedSession || session;
      }

      if (session) {
        console.log(
          "[VAPI WEBHOOK] Updated transcript for session:",
          session.id
        );
        after(async () => {
          try {
            const canonicalUserId = await resolveCanonicalUserId(
              supabase,
              session.user_id
            );

            if (canonicalUserId !== session.user_id) {
              await supabase
                .from("sessions")
                .update({ user_id: canonicalUserId })
                .eq("id", session.id);

              await supabase
                .from("forensics_reports")
                .update({ user_id: canonicalUserId })
                .eq("session_id", session.id);
            }

            if (!hasTranscript) {
              console.warn(
                "[VAPI WEBHOOK] Missing transcript; skipping memory extract for session:",
                session.id
              );
            }

            const generated = await generateKabirNotes(session.id, canonicalUserId);

            const transcriptText = JSON.stringify(mergedTranscript);
            const kabirNotesText = generated?.notes
              ? formatKabirNotesForMemory(generated.notes)
              : "Kabir notes were unavailable at memory-save time.";

            if (!canonicalUserId) {
              console.error("Failed to save memory: missing userId");
            } else {
              console.log("Saving memory for user:", canonicalUserId);
              console.log("Transcript length:", transcriptText.length);
              console.log(
                "SUPERMEMORY_API_KEY configured:",
                hasSupermemory()
              );
              try {
                await saveSessionMemory(
                  canonicalUserId,
                  session.id,
                  transcriptText,
                  kabirNotesText
                );
                console.log(
                  "Memory saved successfully for user:",
                  canonicalUserId
                );
              } catch (error) {
                console.error("Failed to save memory:", error);
              }
            }

            try {
              const people = await extractPeopleProfiles(transcriptText);
              for (const person of people) {
                const insights = `Name: ${person.name}
Relationship: ${person.relationship || "unknown"}
Personality traits: ${person.traits || "unknown"}
How they react under tension: ${person.reactionStyle || "unknown"}
Interaction history: ${person.history || "unknown"}
Possible positive intent: ${person.positiveIntent || "unknown"}
Last discussed: ${new Date().toISOString().split("T")[0]}`;
                await savePersonProfile(canonicalUserId, person.name, insights);
              }
            } catch (peopleErr) {
              console.error("[VAPI WEBHOOK] people extraction failed:", peopleErr);
            }

            const { count: completedSessionsCount } = await supabase
              .from("sessions")
              .select("id", { count: "exact", head: true })
              .eq("user_id", canonicalUserId)
              .eq("status", "completed");

            if ((completedSessionsCount || 0) >= 2) {
              try {
                const crossSessionInsight = await analyzePatterns(
                  canonicalUserId,
                  transcriptText
                );
                if (crossSessionInsight && generated?.notes) {
                  const nextMoments = {
                    ...(generated.notes as Record<string, unknown>),
                    cross_session_insight: crossSessionInsight,
                  };
                  await supabase
                    .from("forensics_reports")
                    .update({ moments: nextMoments })
                    .eq("session_id", session.id);
                }
              } catch (patternErr) {
                console.error(
                  "[VAPI WEBHOOK] analyzePatterns failed:",
                  patternErr
                );
              }
            }

            const extracted = toMemoryMessages(mergedTranscript);
            const memoryEnabled = await getMemoryPreference(canonicalUserId);
            if (memoryEnabled && extracted.length > 0) {
              await memoryService.extractAndRemember(canonicalUserId, extracted);
            }
          } catch (err) {
            console.error("[VAPI WEBHOOK] Post-session processing error:", err);
          }
        });
      } else {
        console.log(
          "[VAPI WEBHOOK] No session found for vapi_call_id:",
          callId
        );
      }
      break;
    }

    case "status-update": {
      const { status, call } = body.message || body;
      const callId = call?.id;
      console.log(
        `[VAPI WEBHOOK] status-update status=${status} callId=${callId}`
      );
      if (!callId) break;

      if (status === "ended") {
        const endedAtIso = new Date().toISOString();
        const { data: existingSession } = await supabase
          .from("sessions")
          .select("id, started_at")
          .eq("vapi_call_id", callId)
          .maybeSingle();

        const startedMs = existingSession?.started_at
          ? Date.parse(existingSession.started_at)
          : NaN;
        const durationSeconds = Number.isFinite(startedMs)
          ? Math.max(0, Math.round((Date.now() - startedMs) / 1000))
          : null;

        const updatePayload: Record<string, unknown> = {
          status: "completed",
          ended_at: endedAtIso,
        };

        if (durationSeconds !== null) {
          updatePayload.duration_seconds = durationSeconds;
        }

        await supabase
          .from("sessions")
          .update(updatePayload)
          .eq("vapi_call_id", callId);
      }
      break;
    }

    case "speech-update":
    case "transcript":
    case "hang":
    case "function-call":
    case "tool-calls":
    case "conversation-update":
    case "assistant.started": {
      break;
    }

    default: {
      console.log(`[VAPI WEBHOOK] unhandled type: ${type}`);
      break;
    }
  }

  return NextResponse.json({ ok: true });
}
