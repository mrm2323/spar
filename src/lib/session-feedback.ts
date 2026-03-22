import { createSupabaseAdmin } from "@/lib/supabase/server";

const ALLOWED_SOURCES = new Set(["end_call", "notes_page", "api"]);
const MAX_FEEDBACK_LENGTH = 2000;

export type SessionFeedbackInput = {
  call_rating: number;
  csat_recommend_score: number;
  call_feedback: string | null;
  source: "end_call" | "notes_page" | "api";
  metadata: Record<string, unknown>;
};

function asIntegerInRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

function asMetadataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function parseSessionFeedbackInput(raw: unknown): {
  value: SessionFeedbackInput | null;
  error: string | null;
} {
  if (!raw || typeof raw !== "object") {
    return { value: null, error: "Invalid feedback payload." };
  }

  const data = raw as Record<string, unknown>;
  const callRating = asIntegerInRange(data.call_rating, 1, 5);
  if (!callRating) {
    return { value: null, error: "call_rating must be an integer from 1 to 5." };
  }

  const csatScore = asIntegerInRange(data.csat_recommend_score, 1, 10);
  if (!csatScore) {
    return {
      value: null,
      error: "csat_recommend_score must be an integer from 1 to 10.",
    };
  }

  const noteRaw = typeof data.call_feedback === "string" ? data.call_feedback.trim() : "";
  const note = noteRaw ? noteRaw.slice(0, MAX_FEEDBACK_LENGTH) : null;

  const sourceRaw = typeof data.source === "string" ? data.source : "end_call";
  const source = ALLOWED_SOURCES.has(sourceRaw)
    ? (sourceRaw as SessionFeedbackInput["source"])
    : "end_call";

  return {
    value: {
      call_rating: callRating,
      csat_recommend_score: csatScore,
      call_feedback: note,
      source,
      metadata: asMetadataObject(data.metadata),
    },
    error: null,
  };
}

export async function upsertSessionFeedback({
  supabase,
  sessionId,
  userId,
  feedback,
}: {
  supabase: ReturnType<typeof createSupabaseAdmin>;
  sessionId: string;
  userId: string;
  feedback: SessionFeedbackInput;
}) {
  const nowIso = new Date().toISOString();

  return supabase.from("session_feedback").upsert(
    {
      session_id: sessionId,
      user_id: userId,
      call_rating: feedback.call_rating,
      call_feedback: feedback.call_feedback,
      csat_recommend_score: feedback.csat_recommend_score,
      source: feedback.source,
      metadata: feedback.metadata,
      submitted_at: nowIso,
      updated_at: nowIso,
    },
    {
      onConflict: "session_id",
      ignoreDuplicates: false,
    }
  );
}
