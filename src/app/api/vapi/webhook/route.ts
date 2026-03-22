import { after } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { generateKabirNotes } from "@/lib/forensics/generate";
import { buildFullKabirContext } from "@/lib/kabir/memory";
import { buildKabirPrompt } from "@/lib/kabir/system-prompt";
import memoryService from "@/services/memory";
import { getMemoryPreference } from "@/lib/memory/preferences";
import { NextResponse } from "next/server";

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

      const memoryText = await buildFullKabirContext(resolvedUserId, supabase);

      const systemPrompt = buildKabirPrompt({
        scenarioRaw: undefined,
        channel: "phone",
        durationSeconds: 600,
        userMemory: memoryText.trim() ? memoryText : undefined,
      });

      if (phoneNumber) {
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
          firstMessage:
            "Hey. It's Kabir. What conversation are you looking forward to?",
          maxDurationSeconds: 600,
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
      const transcript =
        artifact.messages || artifact.transcript || msg.transcript || null;
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

            await generateKabirNotes(session.id, canonicalUserId);

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
        await supabase
          .from("sessions")
          .update({
            status: "completed",
            ended_at: new Date().toISOString(),
          })
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
