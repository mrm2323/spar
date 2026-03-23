import { after } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { generateKabirNotes } from "@/lib/forensics/generate";
import {
  buildFullKabirContext,
  formatKabirNotesForMemory,
  hasSupermemory,
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
      try {
        const memoryOn = await getMemoryPreference(resolvedUserId);
        if (memoryOn) {
          memoryText = await buildFullKabirContext(resolvedUserId, supabase);
        }
      } catch {
        memoryText = await buildFullKabirContext(resolvedUserId, supabase);
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
            waitSeconds: 0.6,
            smartEndpointingEnabled: true,
          },
          stopSpeakingPlan: {
            numWords: 1,
            voiceSeconds: 0.2,
            backoffSeconds: 1.5,
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

      const { data: session } = await supabase
        .from("sessions")
        .update({ transcript })
        .eq("vapi_call_id", callId)
        .select("id, user_id")
        .single();

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

            const transcriptText =
              typeof transcript === "string" ? transcript : JSON.stringify(transcript);
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

            const extracted = toMemoryMessages(transcript);
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
