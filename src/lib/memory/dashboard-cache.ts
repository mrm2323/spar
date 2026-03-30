import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import memoryService from "@/services/memory";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { getDeepMemoryContext, hasSupermemory } from "@/lib/kabir/memory";
import { getRecentSessionSummariesForPrompt } from "@/lib/kabir/session-history";

export type PatternCard = {
  name: string;
  description: string;
  status: "improving" | "persistent";
  sessionCount: number;
};

export type DashboardCachePayload = {
  profileText: string;
  patterns: PatternCard[];
  invalidationKey: string;
  generatedAt: string;
};

function isMissingUserMemoryCacheTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  return (
    e.code === "PGRST205" &&
    typeof e.message === "string" &&
    e.message.includes("user_memory_cache")
  );
}

function isMissingUserMemoryColumnError(error: unknown, column: string): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  return (
    e.code === "PGRST204" &&
    typeof e.message === "string" &&
    e.message.includes(`'${column}'`) &&
    e.message.includes("user_memory")
  );
}

/**
 * Fingerprint for cache invalidation: completed-session count + latest activity time.
 * Latest time = max per row of (ended_at, created_at) so null ended_at still invalidates correctly.
 */
async function getSessionFingerprint(
  supabase: SupabaseClient,
  userId: string,
  options?: { resetAfterIso?: string | null }
): Promise<{ invalidationKey: string; sessionCount: number }> {
  let countQuery = supabase
    .from("sessions")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "completed");
  if (options?.resetAfterIso) {
    countQuery = countQuery.gte("created_at", options.resetAfterIso);
  }
  const { count } = await countQuery;

  const sessionCount = typeof count === "number" ? count : 0;

  let rowsQuery = supabase
    .from("sessions")
    .select("ended_at, created_at")
    .eq("user_id", userId)
    .eq("status", "completed")
    .limit(120);
  if (options?.resetAfterIso) {
    rowsQuery = rowsQuery.gte("created_at", options.resetAfterIso);
  }
  const { data: rows } = await rowsQuery;

  let latestMs = 0;
  for (const r of rows ?? []) {
    const e = r.ended_at ? new Date(String(r.ended_at)).getTime() : 0;
    const c = r.created_at ? new Date(String(r.created_at)).getTime() : 0;
    const m = Math.max(e, c);
    if (m > latestMs) latestMs = m;
  }
  const t = latestMs > 0 ? new Date(latestMs).toISOString() : "";

  return {
    invalidationKey: `${sessionCount}|${t}`,
    sessionCount,
  };
}

async function buildCorpus(
  userId: string,
  supabase: SupabaseClient,
  options?: { resetAfterIso?: string | null }
): Promise<string> {
  const chunks: string[] = [];
  if (hasSupermemory()) {
    try {
      const deep = await getDeepMemoryContext(userId);
      if (deep?.trim()) chunks.push(deep.trim());
    } catch (e) {
      console.error("[dashboard-cache] deep memory", e);
    }
    try {
      const memories = await memoryService.listMemories(userId, { limit: 40 });
      for (const m of memories) {
        const c = typeof m.content === "string" ? m.content.trim() : "";
        if (c) chunks.push(c);
      }
    } catch (e) {
      console.error("[dashboard-cache] listMemories", e);
    }
  }
  const db = await getRecentSessionSummariesForPrompt(supabase, userId, 15, {
    resetAfterIso: options?.resetAfterIso,
  });
  if (db?.trim()) chunks.push(db.trim());

  const uniq = [...new Set(chunks)];
  return uniq.join("\n\n---\n\n").slice(0, 52_000);
}

function openaiClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey: key });
}

async function generatePortraitAndPatterns(
  corpus: string,
  completedSessionCount: number
): Promise<{
  portrait: string;
  patterns: PatternCard[];
}> {
  const maxPatternSessions = Math.min(50, Math.max(0, completedSessionCount));
  const openai = openaiClient();
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You help build Spar's Memory dashboard. Respond with valid JSON only:
{
  "portrait": "3-4 sentences, second person, Kabir's voice (direct, warm, honest), specific patterns and progress",
  "patterns": [
    {
      "name": "THE APOLOGY REFLEX",
      "description": "One line: what Kabir has noticed and how often (e.g. 'in 3 of 4 sessions').",
      "status": "improving",
      "sessionCount": 3
    }
  ]
}
Rules:
- patterns: 3-4 items max, uppercase-style labels (THE OVER-EXPLAIN, THE CONFIDENCE DROP).
- status is either "improving" or "persistent".
- sessionCount per pattern: integer from 1 to at most the user's completed practice session count (never invent more sessions than they have actually completed).
- If the corpus is sparse, use a warm placeholder portrait and 0-2 patterns.`,
      },
      {
        role: "user",
        content: `Completed practice sessions (fact): ${completedSessionCount}
Pattern sessionCount must be integers from 0 to ${maxPatternSessions} (0 only if no sessions yet).

Everything Kabir knows about this person from sessions and memory:

${corpus || "(empty)"}`,
      },
    ],
    temperature: 0.65,
  });

  const raw = response.choices[0]?.message?.content?.trim() || "{}";
  let parsed: { portrait?: string; patterns?: unknown[] };
  try {
    parsed = JSON.parse(raw) as { portrait?: string; patterns?: unknown[] };
  } catch {
    return {
      portrait:
        "You and Kabir are building something real here. Practice a bit more and this portrait will grow sharper.",
      patterns: [],
    };
  }

  const portrait =
    typeof parsed.portrait === "string" && parsed.portrait.trim()
      ? parsed.portrait.trim()
      : "You and Kabir are just getting started. Keep practicing — this portrait will get more specific with every session.";

  const patterns: PatternCard[] = [];
  if (Array.isArray(parsed.patterns)) {
    for (const p of parsed.patterns.slice(0, 4)) {
      if (!p || typeof p !== "object") continue;
      const o = p as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.trim() : "";
      const description =
        typeof o.description === "string" ? o.description.trim() : "";
      if (!name || !description) continue;
      const status =
        o.status === "improving" ? "improving" : "persistent";
      const rawSc =
        typeof o.sessionCount === "number" && Number.isFinite(o.sessionCount)
          ? Math.round(o.sessionCount)
          : completedSessionCount > 0
            ? 1
            : 0;
      const upper = Math.max(0, completedSessionCount);
      const capped =
        upper === 0
          ? 0
          : Math.min(Math.max(1, rawSc), upper);
      if (capped === 0) continue;
      patterns.push({ name, description, status, sessionCount: capped });
    }
  }

  return { portrait, patterns };
}

export async function getOrBuildDashboardCache(
  userId: string,
  options?: { resetAfterIso?: string | null }
): Promise<
  DashboardCachePayload & { sessionCount: number; cacheHit: boolean }
> {
  const supabase = createSupabaseAdmin();
  const { invalidationKey, sessionCount } = await getSessionFingerprint(
    supabase,
    userId,
    options
  );

  const { data: row, error: cacheReadErr } = await supabase
    .from("user_memory_cache")
    .select("profile_text, patterns_json, invalidation_key, generated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (cacheReadErr && !isMissingUserMemoryCacheTableError(cacheReadErr)) {
    console.error("[dashboard-cache] read cache failed:", cacheReadErr);
  }

  if (
    row &&
    row.invalidation_key === invalidationKey &&
    typeof row.profile_text === "string" &&
    row.profile_text.trim().length > 0
  ) {
    const rawPatterns = Array.isArray(row.patterns_json)
      ? (row.patterns_json as PatternCard[])
      : [];
    const upper = Math.max(0, sessionCount);
    const patterns = rawPatterns.map((p) => ({
      ...p,
      sessionCount:
        upper === 0
          ? 0
          : Math.min(
              Math.max(1, p.sessionCount),
              upper
            ),
    })).filter((p) => p.sessionCount > 0);
    return {
      profileText: row.profile_text,
      patterns,
      invalidationKey,
      generatedAt: row.generated_at as string,
      sessionCount,
      cacheHit: true,
    };
  }

  const corpus = await buildCorpus(userId, supabase, options);
  const { portrait, patterns } = await generatePortraitAndPatterns(
    corpus,
    sessionCount
  );

  const now = new Date().toISOString();
  const { error: upsertErr } = await supabase.from("user_memory_cache").upsert(
    {
      user_id: userId,
      profile_text: portrait,
      patterns_json: patterns,
      invalidation_key: invalidationKey,
      generated_at: now,
    },
    { onConflict: "user_id" }
  );

  if (upsertErr && !isMissingUserMemoryCacheTableError(upsertErr)) {
    console.error("[dashboard-cache] upsert failed:", upsertErr);
  }

  return {
    profileText: portrait,
    patterns,
    invalidationKey,
    generatedAt: now,
    sessionCount,
    cacheHit: false,
  };
}

export async function deleteUserMemoryCache(userId: string): Promise<void> {
  const supabase = createSupabaseAdmin();
  const { error } = await supabase
    .from("user_memory_cache")
    .delete()
    .eq("user_id", userId);
  if (error && !isMissingUserMemoryCacheTableError(error)) {
    console.error("[dashboard-cache] delete cache failed:", error);
  }
}

/**
 * Clears Supabase-stored coaching artifacts. Always runs for "forget everything"
 * even when Supermemory is disabled or fails — fixes empty moat UX in dev.
 */
export async function wipeLocalUserMemoryArtifacts(userId: string): Promise<{
  ok: boolean;
}> {
  const supabase = createSupabaseAdmin();
  const { error: cacheDeleteErr } = await supabase
    .from("user_memory_cache")
    .delete()
    .eq("user_id", userId);
  if (cacheDeleteErr && !isMissingUserMemoryCacheTableError(cacheDeleteErr)) {
    console.error("[dashboard-cache] wipe cache delete", cacheDeleteErr);
  }

  const now = new Date().toISOString();
  const fullPayload: Record<string, unknown> = {
    user_id: userId,
    kabir_memory: "",
    patterns: [],
    weaknesses: [],
    improvements: [],
    updated_at: now,
  };

  const tryPayloads: Array<Record<string, unknown>> = [
    fullPayload,
    // Older schemas may not have kabir_memory.
    { user_id: userId, patterns: [], weaknesses: [], improvements: [], updated_at: now },
    // Narrow fallback if some arrays are absent.
    { user_id: userId, patterns: [], updated_at: now },
    // Last-resort keep row writable so clear action does not hard-fail.
    { user_id: userId, updated_at: now },
  ];

  let upErr: unknown = null;
  let writeOk = false;
  for (const payload of tryPayloads) {
    const { error } = await supabase
      .from("user_memory")
      .upsert(payload, { onConflict: "user_id" });
    if (!error) {
      writeOk = true;
      upErr = null;
      break;
    }
    upErr = error;
    if (
      isMissingUserMemoryColumnError(error, "kabir_memory") ||
      isMissingUserMemoryColumnError(error, "weaknesses") ||
      isMissingUserMemoryColumnError(error, "improvements") ||
      isMissingUserMemoryColumnError(error, "patterns")
    ) {
      continue;
    }
    break;
  }

  if (upErr) {
    console.error("[dashboard-cache] wipe user_memory", upErr);
  }

  return { ok: writeOk };
}

/**
 * Clears AI-generated pattern cards and legacy pattern fields without wiping portrait,
 * Supermemory facts, or full cache. Patterns repopulate on the next cache rebuild
 * (e.g. after a completed session when the session fingerprint changes).
 */
export async function clearPatternRecognition(
  userId: string
): Promise<{ ok: boolean }> {
  const supabase = createSupabaseAdmin();
  const now = new Date().toISOString();

  const { error: cacheErr } = await supabase.from("user_memory_cache").upsert(
    {
      user_id: userId,
      patterns_json: [],
      generated_at: now,
    },
    { onConflict: "user_id" }
  );

  if (cacheErr && !isMissingUserMemoryCacheTableError(cacheErr)) {
    console.error("[dashboard-cache] clear patterns_json", cacheErr);
  }

  let memErr: unknown = null;
  let memOk = false;
  const fallbackUpdates: Array<Record<string, unknown>> = [
    { weaknesses: [], patterns: [] },
    { patterns: [] },
  ];

  for (const updateBody of fallbackUpdates) {
    const { error } = await supabase
      .from("user_memory")
      .update(updateBody)
      .eq("user_id", userId);
    if (!error) {
      memOk = true;
      memErr = null;
      break;
    }
    memErr = error;
    if (
      isMissingUserMemoryColumnError(error, "weaknesses") ||
      isMissingUserMemoryColumnError(error, "patterns")
    ) {
      continue;
    }
    break;
  }

  if (memErr) {
    console.error("[dashboard-cache] clear user_memory patterns", memErr);
  }

  return { ok: memOk };
}
