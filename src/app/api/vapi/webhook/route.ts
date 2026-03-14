import { after } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import {
  generateKabirNotes,
  generateMemoryUpdate,
} from "@/lib/forensics/generate";
import { buildSystemPrompt } from "@/lib/kabir/system-prompt";
import { NextResponse } from "next/server";

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
      const phoneNumber = call?.customer?.number;
      console.log(
        "[VAPI WEBHOOK] assistant-request from phone:",
        phoneNumber || "web"
      );

      let resolvedUserId = phoneNumber ? `phone:${phoneNumber}` : "unknown";
      let memory = null;

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
          memory = memoryRow;
          console.log(
            "[VAPI WEBHOOK] Resolved phone to user:",
            resolvedUserId
          );
        }
      }

      const systemPrompt = buildSystemPrompt(null, memory);

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
            "Hey. It's Kabir. What conversation are you avoiding?",
          maxDurationSeconds: 600,
          startSpeakingPlan: {
            waitSeconds: 2.5,
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
            await generateKabirNotes(session.id, session.user_id);
            await generateMemoryUpdate(session.id, session.user_id);
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
