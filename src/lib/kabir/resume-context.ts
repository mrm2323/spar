import { createSupabaseAdmin } from "@/lib/supabase/server";
import { sessionBelongsToUser } from "@/lib/session-access";

function formatWhatFragment(v: unknown): string {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as { quote?: string; why?: string };
    const q = (o.quote || "").trim();
    const w = (o.why || "").trim();
    if (!q && !w) return "";
    if (q && w) return `"${q}" — ${w}`;
    return q || w;
  }
  return "";
}

/**
 * Build prompt text so Kabir continues a prior practice from DB truth
 * (context, notes, transcript) — works even if Supermemory is empty.
 */
export async function buildResumeContextForPrompt(
  sessionId: string,
  userId: string
): Promise<string | null> {
  const supabase = createSupabaseAdmin();
  const allowed = await sessionBelongsToUser(supabase, sessionId, userId);
  if (!allowed) return null;

  const { data: session } = await supabase
    .from("sessions")
    .select("context, transcript, created_at, ended_at")
    .eq("id", sessionId)
    .single();

  if (!session) return null;

  const { data: report } = await supabase
    .from("forensics_reports")
    .select("moments, summary")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const notes = report?.moments as Record<string, unknown> | undefined;
  const summary =
    (typeof notes?.kabirTake === "string" && notes.kabirTake) ||
    (typeof notes?.summary === "string" && notes.summary) ||
    report?.summary ||
    "";
  const beforeYou =
    typeof notes?.beforeYouWalkIn === "string"
      ? notes.beforeYouWalkIn.trim()
      : "";
  const nextTime =
    beforeYou ||
    (typeof notes?.next_time === "string" ? notes.next_time : "");
  const strongest =
    notes?.strongestMoment && typeof notes.strongestMoment === "object"
      ? formatWhatFragment({
          quote: (notes.strongestMoment as { quote?: string }).quote,
          why: (notes.strongestMoment as { why?: string }).why,
        })
      : formatWhatFragment(notes?.whatWorked ?? notes?.what_worked) || "";
  const weakest =
    notes?.weakestMoment && typeof notes.weakestMoment === "object"
      ? formatWhatFragment({
          quote: (notes.weakestMoment as { quote?: string }).quote,
          why: (notes.weakestMoment as { why?: string }).why,
        })
      : formatWhatFragment(notes?.whatToRethink ?? notes?.what_to_rethink) ||
        "";

  const whatWorked = strongest;
  const rethink = weakest;

  let transcriptExcerpt = "";
  if (session.transcript) {
    const t =
      typeof session.transcript === "string"
        ? session.transcript
        : JSON.stringify(session.transcript);
    transcriptExcerpt = t.length > 6000 ? t.slice(-6000) : t;
  }

  return `
════════════════════════
CONTINUING WHERE YOU LEFT OFF
════════════════════════
They tapped "Continue this practice" — this is the SAME situation as before, not a new topic.

Original context they shared: ${session.context?.trim() || "None recorded."}

Your last read on that session (summary): ${summary || "Notes not ready yet — use transcript below."}

What worked in practice: ${whatWorked || "—"}
What to rethink: ${rethink || "—"}
Your instruction for the real moment: ${nextTime || "—"}

Recent practice transcript (use names, phrases, and emotional beats from here — this is ground truth):
${transcriptExcerpt || "(No transcript stored yet — open with: \"We're back on this — what's changed since last time?\")"}

Open the call acknowledging continuation. Do not restart the generic "what conversation" intro.
Ask what shifted or what they want to tighten, then go straight into another rep.
`.trim();
}

export function defaultResumeFirstMessage(firstName?: string | null): string {
  const n = firstName?.trim();
  if (n) {
    return `Hey ${n} — we're picking this back up. What's different since last time, or what do you want to run again?`;
  }
  return "Hey — we're picking this back up. What's different since last time, or what do you want to run again?";
}
