import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Pull recent practice history from Supabase so Kabir has continuity even if
 * Supermemory search is sparse or still indexing.
 */
export async function getRecentSessionSummariesForPrompt(
  supabase: SupabaseClient,
  userId: string,
  limit = 10
): Promise<string> {
  const { data: sessions, error } = await supabase
    .from("sessions")
    .select("id, context, ended_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !sessions?.length) {
    return "";
  }

  const ids = sessions.map((s) => s.id);
  const { data: reports } = await supabase
    .from("forensics_reports")
    .select("session_id, summary, moments")
    .in("session_id", ids);

  const reportBySession = new Map(
    (reports ?? []).map((r) => [r.session_id as string, r])
  );

  const lines: string[] = [];
  for (const s of sessions) {
    const r = reportBySession.get(s.id);
    const moments = r?.moments as Record<string, unknown> | undefined;
    const sum =
      (typeof moments?.summary === "string" && moments.summary) ||
      (typeof r?.summary === "string" && r.summary) ||
      "";
    const when = s.ended_at || s.created_at;
    const dateLabel =
      typeof when === "string"
        ? when.slice(0, 10)
        : new Date().toISOString().slice(0, 10);
    const ctx = (s.context ?? "").trim().slice(0, 200);
    const summaryLine = sum.trim().slice(0, 420);
    if (!summaryLine && !ctx) continue;
    const parts: string[] = [`(${dateLabel})`];
    if (ctx) parts.push(`They said they were working on: ${ctx}`);
    if (summaryLine) parts.push(`Kabir's read: ${summaryLine}`);
    lines.push(parts.join(" "));
  }

  return lines.join("\n");
}
