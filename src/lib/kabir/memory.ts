/**
 * Kabir ↔ Supermemory (v3 REST)
 *
 * Auth: `Authorization: Bearer ${process.env.SUPERMEMORY_API_KEY}` (server-only).
 *
 * **Ingest:** Official API is `POST ${SUPERMEMORY_URL}/documents` with `containerTag`
 * (string) — not legacy `/add`. We use `userContainerTag(userId)` so IDs like `phone:+1…`
 * stay valid for Supermemory tag rules.
 *
 * **Read:** `getMemoryContext` / `getDeepMemoryContext` + `searchMemory` use `POST …/search`.
 *
 * **Session flow:** `saveSessionMemory` runs after forensics (`generate.ts`). Session start
 * uses `buildFullKabirContext` = Supermemory + recent Supabase session summaries (+ resume).
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRecentSessionSummariesForPrompt } from "@/lib/kabir/session-history";

/** API base — https://api.supermemory.ai/v3 */
export const SUPERMEMORY_URL = "https://api.supermemory.ai/v3";

function getHeaders(): HeadersInit {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) {
    throw new Error("SUPERMEMORY_API_KEY is not set");
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export function hasSupermemory(): boolean {
  return Boolean(process.env.SUPERMEMORY_API_KEY?.trim());
}

/**
 * Stable, API-safe container tag per user (Clerk IDs, phone:…, etc.).
 */
export function userContainerTag(userId: string): string {
  const raw = userId.trim();
  if (!raw) return "u_unknown";
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (safe.length <= 100) return safe;
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 40);
  return `u_${hash}`;
}

function flattenMetadata(
  meta: Record<string, unknown>
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      out[k] = v;
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

/** Ingest or update a document (customId enables upsert / continuation). */
async function ingestDocument(params: {
  content: string;
  containerTag: string;
  customId?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: boolean; status: number; body?: string }> {
  const body: Record<string, unknown> = {
    content: params.content,
    containerTag: params.containerTag,
  };
  if (params.customId) body.customId = params.customId;
  if (params.metadata && Object.keys(params.metadata).length > 0) {
    body.metadata = flattenMetadata(params.metadata);
  }

  const res = await fetch(`${SUPERMEMORY_URL}/documents`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body: text };
}

async function searchDocuments(params: {
  q: string;
  containerTags: string[];
  limit?: number;
}): Promise<Record<string, unknown>> {
  const res = await fetch(`${SUPERMEMORY_URL}/search`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      q: params.q,
      containerTags: params.containerTags,
      limit: params.limit ?? 20,
      chunkThreshold: 0.28,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[Supermemory] search failed:", res.status, errText);
    return {};
  }

  return (await res.json()) as Record<string, unknown>;
}

function extractResultText(r: Record<string, unknown>): string {
  if (typeof r.content === "string") return r.content;
  if (typeof r.text === "string") return r.text;
  const chunk = r.chunk as Record<string, unknown> | undefined;
  if (chunk && typeof chunk.content === "string") return chunk.content;
  const mem = r.memory as Record<string, unknown> | undefined;
  if (mem && typeof mem.content === "string") return mem.content;
  return "";
}

function normalizeSearchResults(data: Record<string, unknown>): unknown[] {
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.documents)) return data.documents;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.chunks)) return data.chunks;
  return [];
}

/**
 * After every session: store transcript + notes. Same customId updates the doc.
 */
export async function saveSessionMemory(
  userId: string,
  sessionId: string,
  transcript: string,
  kabirNotes: string
): Promise<void> {
  if (!hasSupermemory()) {
    console.warn("[Supermemory] SUPERMEMORY_API_KEY missing — skip saveSessionMemory");
    return;
  }

  const content = `
Session date: ${new Date().toISOString().split("T")[0]}
Session ID: ${sessionId}

--- Conversation (practice) ---
${transcript}

--- Kabir session notes ---
${kabirNotes}
  `.trim();

  const tag = userContainerTag(userId);

  try {
    const { ok, status, body } = await ingestDocument({
      content,
      containerTag: tag,
      customId: `kabir_session_${sessionId}`,
      metadata: {
        type: "kabir_session",
        sessionId,
        date: new Date().toISOString(),
      },
    });

    if (!ok) {
      console.error("[Supermemory] session ingest failed:", status, body?.slice(0, 500));
    }
  } catch (e) {
    console.error("[Supermemory] saveSessionMemory error:", e);
  }
}

/**
 * Rolling “who they are” paragraph — upserted each time we process notes.
 */
export async function upsertOverallProfileMemory(
  userId: string,
  profileParagraph: string
): Promise<void> {
  if (!hasSupermemory()) return;

  const tag = userContainerTag(userId);
  const content = `KABIR_RUNNING_PROFILE\n\n${profileParagraph.trim()}`;

  try {
    const { ok, status, body } = await ingestDocument({
      content,
      containerTag: tag,
      customId: `kabir_overall_${tag}`,
      metadata: {
        type: "kabir_overall_profile",
        date: new Date().toISOString(),
      },
    });
    if (!ok) {
      console.error("[Supermemory] overall profile ingest failed:", status, body?.slice(0, 400));
    }
  } catch (e) {
    console.error("[Supermemory] upsertOverallProfileMemory error:", e);
  }
}

/**
 * Layer from Supermemory about a specific past session (supplements Supabase on resume).
 */
export async function getSessionMemoryLayer(
  userId: string,
  sessionId: string
): Promise<string> {
  if (!hasSupermemory()) return "";

  const tag = userContainerTag(userId);
  const data = await searchDocuments({
    q: `Kabir practice session ${sessionId} coaching transcript`,
    containerTags: [tag],
    limit: 8,
  });

  const results = normalizeSearchResults(data);
  const parts = results
    .map((r) => extractResultText(r as Record<string, unknown>))
    .filter((m) => m.length > 0);

  return parts.join("\n\n").trim();
}

/**
 * Deep retrieval: multiple semantic angles so Kabir isn't "starting cold"
 * when topics differ across sessions.
 */
export async function getDeepMemoryContext(userId: string): Promise<string> {
  if (!hasSupermemory()) return "";

  const tag = userContainerTag(userId);

  try {
    const searches = await Promise.all([
      searchDocuments({
        q: "KABIR_RUNNING_PROFILE overall life situation goals stressors identity",
        containerTags: [tag],
        limit: 16,
      }),
      searchDocuments({
        q: "every practice session topic conversation rehearsed salary roommate interview boundary",
        containerTags: [tag],
        limit: 18,
      }),
      searchDocuments({
        q: "patterns habits hedging confidence directness communication weaknesses strengths",
        containerTags: [tag],
        limit: 16,
      }),
      searchDocuments({
        q: "relationships manager professor family partner friends conflict emotional",
        containerTags: [tag],
        limit: 14,
      }),
      searchDocuments({
        q: "fear anxiety shame cultural visa international deadline upcoming event",
        containerTags: [tag],
        limit: 14,
      }),
    ]);

    const merged = new Map<string, string>();
    for (const data of searches) {
      for (const r of normalizeSearchResults(data)) {
        const text = extractResultText(r as Record<string, unknown>).trim();
        if (text.length < 15) continue;
        const key = text.slice(0, 140);
        if (!merged.has(key)) merged.set(key, text.slice(0, 4000));
      }
    }

    return Array.from(merged.values()).join("\n\n");
  } catch (e) {
    console.error("[Supermemory] getDeepMemoryContext error:", e);
    return "";
  }
}

/**
 * Everything Kabir can retrieve about this user from Supermemory (multi-query).
 * For “single broad question” behavior, see also `searchMemory`.
 */
export async function getMemoryContext(userId: string): Promise<string> {
  return getDeepMemoryContext(userId);
}

/**
 * Supermemory layers + optional thread for the session being resumed.
 */
export async function buildKabirMemoryBundle(
  userId: string,
  options?: { resumeSessionId?: string | null }
): Promise<string> {
  const base = await getDeepMemoryContext(userId);
  if (!options?.resumeSessionId) {
    return base.trim();
  }

  const layer = await getSessionMemoryLayer(userId, options.resumeSessionId);
  if (!layer) return base.trim();
  if (!base.trim()) return layer;
  return `${base.trim()}\n\n---\nFrom stored memory about the session they are resuming:\n${layer}`;
}

/**
 * Full stack for every call: deep Supermemory + optional resume thread +
 * Supabase timeline (so Kabir is never a stranger even if search misses).
 */
export async function buildFullKabirContext(
  userId: string,
  supabase: SupabaseClient,
  options?: { resumeSessionId?: string | null }
): Promise<string> {
  const [bundle, dbHistory] = await Promise.all([
    buildKabirMemoryBundle(userId, options),
    getRecentSessionSummariesForPrompt(supabase, userId, 12),
  ]);

  const parts: string[] = [];
  if (bundle.trim()) parts.push(bundle.trim());
  if (dbHistory.trim()) {
    parts.push(
      `RECENT PRACTICE SESSIONS (authoritative timeline — topics may differ; you still know this person)\n${dbHistory}`
    );
  }
  return parts.join("\n\n---\n\n");
}

export async function searchMemory(
  userId: string,
  query: string
): Promise<string[]> {
  if (!hasSupermemory()) return [];

  const tag = userContainerTag(userId);
  const data = await searchDocuments({
    q: query,
    containerTags: [tag],
    limit: 5,
  });

  return normalizeSearchResults(data)
    .map((r) => extractResultText(r as Record<string, unknown>))
    .filter((m) => m.length > 0);
}

export async function addUserMemory(
  userId: string,
  content: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  if (!hasSupermemory()) return;

  try {
    const { ok, status, body } = await ingestDocument({
      content,
      containerTag: userContainerTag(userId),
      metadata: {
        ...metadata,
        date: new Date().toISOString(),
      },
    });
    if (!ok) {
      console.error("[Supermemory] addUserMemory failed:", status, body?.slice(0, 300));
    }
  } catch (e) {
    console.error("[Supermemory] addUserMemory error:", e);
  }
}

export function formatKabirNotesForMemory(notes: Record<string, unknown>): string {
  const parts: string[] = [];
  const s = (k: string) => {
    const v = notes[k];
    return typeof v === "string" && v.trim() ? v.trim() : "";
  };

  const take = s("kabirTake") || s("summary");
  if (take) parts.push(`Kabir's take: ${take}`);

  const rs = notes.readinessScore;
  const rl = notes.readinessLabel;
  if (typeof rs === "number" && Number.isFinite(rs)) {
    parts.push(`Readiness: ${rs}${typeof rl === "string" ? ` (${rl})` : ""}`);
  }

  const sm = notes.strongestMoment;
  if (sm && typeof sm === "object" && sm !== null) {
    const o = sm as { quote?: string; why?: string; timestamp?: string };
    if (o.quote || o.why) {
      parts.push(
        `Strongest: ${o.quote ? `"${o.quote}"` : ""} ${o.timestamp || ""} ${o.why || ""}`.trim()
      );
    }
  }

  const wm = notes.weakestMoment;
  if (wm && typeof wm === "object" && wm !== null) {
    const o = wm as { quote?: string; why?: string; timestamp?: string };
    if (o.quote || o.why) {
      parts.push(
        `Rethink: ${o.quote ? `"${o.quote}"` : ""} ${o.timestamp || ""} ${o.why || ""}`.trim()
      );
    }
  }

  const ww = notes.whatWorked ?? notes.what_worked;
  if (ww && typeof ww === "object" && ww !== null) {
    const o = ww as { quote?: string; why?: string };
    if (o.quote || o.why) {
      parts.push(
        `What worked: ${o.quote ? `"${o.quote}"` : ""} ${o.why || ""}`.trim()
      );
    }
  } else if (s("what_worked")) {
    parts.push(`What worked: ${s("what_worked")}`);
  }

  const wr = notes.whatToRethink ?? notes.what_to_rethink;
  if (wr && typeof wr === "object" && wr !== null) {
    const o = wr as { quote?: string; why?: string };
    if (o.quote || o.why) {
      parts.push(
        `What to rethink: ${o.quote ? `"${o.quote}"` : ""} ${o.why || ""}`.trim()
      );
    }
  } else if (s("what_to_rethink")) {
    parts.push(`What to rethink: ${s("what_to_rethink")}`);
  }

  const items = notes.actionItems;
  if (Array.isArray(items) && items.length) {
    parts.push(
      `Action items:\n${items.filter((x) => typeof x === "string").join("\n")}`
    );
  }

  const wp = notes.wordPattern;
  if (wp && typeof wp === "object" && wp !== null) {
    const w = wp as Record<string, unknown>;
    parts.push(
      `Word pattern: fillers ${String(w.fillerCount ?? 0)}, hedges ${String(w.hedgeCount ?? 0)}, apologies ${String(w.apologyCount ?? 0)}`
    );
  }

  const before = s("beforeYouWalkIn") || s("next_time");
  if (before) parts.push(`Before you walk in: ${before}`);

  const pat = s("patternDetected");
  if (pat) parts.push(`Pattern: ${pat}`);

  if (s("best_moment")) parts.push(`Best moment: ${s("best_moment")}`);
  if (s("worst_moment")) parts.push(`Worst moment: ${s("worst_moment")}`);
  if (s("one_thing_to_fix")) parts.push(`One thing to fix: ${s("one_thing_to_fix")}`);

  return parts.join("\n\n") || JSON.stringify(notes);
}
