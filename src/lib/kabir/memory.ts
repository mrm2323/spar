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
import OpenAI from "openai";
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

function normalizeTag(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  return cleaned.slice(0, 100) || "unknown";
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
  if (!res.ok) {
    console.error(
      "[Supermemory] ingest /documents failed:",
      res.status,
      text.slice(0, 500)
    );
  }
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
  console.log(
    "[Supermemory] saveSessionMemory start",
    JSON.stringify({
      userId,
      sessionId,
      containerTag: tag,
      transcriptLength: transcript.length,
    })
  );

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
    } else {
      console.log(
        "[Supermemory] saveSessionMemory success",
        JSON.stringify({ userId, sessionId, containerTag: tag, status })
      );
    }
  } catch (e) {
    console.error("[Supermemory] saveSessionMemory error:", e);
  }
}

export async function savePersonProfile(
  userId: string,
  personName: string,
  insights: string
): Promise<void> {
  if (!hasSupermemory()) return;

  const baseUserTag = normalizeTag(`user_${userId}`);
  const peopleTag = normalizeTag(`people_${userId}`);
  const personTag = normalizeTag(
    `person_${personName.toLowerCase().replace(/\s+/g, "_")}_${userId}`
  );
  const content = `PERSON PROFILE: ${personName}\n${insights}`.trim();

  for (const tag of [baseUserTag, peopleTag, personTag]) {
    try {
      const { ok, status, body } = await ingestDocument({
        content,
        containerTag: tag,
        customId: `person_${personTag}`,
        metadata: {
          type: "person_profile",
          personName,
          personTag,
          userTag: baseUserTag,
          peopleTag,
          date: new Date().toISOString(),
        },
      });
      if (!ok) {
        console.error(
          "[Supermemory] savePersonProfile failed:",
          status,
          body?.slice(0, 400)
        );
      }
    } catch (e) {
      console.error("[Supermemory] savePersonProfile error:", e);
    }
  }
}

export async function getPeopleContext(userId: string): Promise<string> {
  if (!hasSupermemory()) return "";

  const peopleTag = normalizeTag(`people_${userId}`);
  const data = await searchDocuments({
    q: "Who are the people in this user's life? What are their personalities, relationship history, past interactions, and behavioral patterns?",
    containerTags: [peopleTag],
    limit: 20,
  });
  const rows = normalizeSearchResults(data)
    .map((r) => extractResultText(r as Record<string, unknown>).trim())
    .filter((t) => t.length > 0);

  return rows.join("\n\n");
}

export async function listKnownPeopleNames(userId: string): Promise<string[]> {
  if (!hasSupermemory()) return [];
  const text = await getPeopleContext(userId);
  if (!text) return [];

  const names = new Set<string>();
  const re = /PERSON PROFILE:\s*([^\n]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = m[1]?.trim();
    if (n) names.add(n);
  }
  return Array.from(names).slice(0, 6);
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
        q: "patterns habits hedging directness communication weaknesses strengths",
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
  const tag = userContainerTag(userId);
  console.log(
    "[Supermemory] getMemoryContext",
    JSON.stringify({ userId, containerTag: tag })
  );
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
    getRecentSessionSummariesForPrompt(supabase, userId, 22),
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

export async function analyzePatterns(
  userId: string,
  currentTranscript: string
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY?.trim()) return null;

  const previousMemories = await getMemoryContext(userId);
  if (!previousMemories || previousMemories.length < 100) return null;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You analyze communication patterns across multiple conversations. You have a user's history from previous sessions and their current session. Find ONE cross-session pattern the user probably cannot see themselves. Write it as one paragraph in a direct, warm, honest voice. Examples: 'Every conversation we have had, you start by making yourself smaller. With your professor you apologized. In your interview you said you were just part of the team. This is not about them. This is about you not believing you are allowed to want things.' If no meaningful pattern exists yet, respond with exactly the word null.",
      },
      {
        role: "user",
        content: `PREVIOUS SESSIONS:\n${previousMemories}\n\nCURRENT SESSION:\n${currentTranscript}`,
      },
    ],
    temperature: 0.7,
  });

  const insight = response.choices[0]?.message?.content?.trim();
  if (!insight || insight === "null") return null;
  return insight;
}

export function formatKabirNotesForMemory(notes: Record<string, unknown>): string {
  const parts: string[] = [];
  const s = (k: string) => {
    const v = notes[k];
    return typeof v === "string" && v.trim() ? v.trim() : "";
  };

  const take = s("kabirTake") || s("summary");
  if (take) parts.push(`Kabir's take: ${take}`);

  const highlights = notes.keyHighlights;
  if (Array.isArray(highlights) && highlights.length) {
    const lines = highlights.filter((x) => typeof x === "string" && x.trim());
    if (lines.length) {
      parts.push(`Key highlights:\n${lines.join("\n")}`);
    }
  }

  const readiness = s("readiness");
  if (readiness) parts.push(`Readiness: ${readiness}`);

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

export type PersonDashboardCard = {
  name: string;
  relationship?: string;
  summary: string;
  fullProfile: string;
  lastDiscussedIso: string | null;
};

/**
 * People profiles stored under `people_{userId}` for the Memory dashboard.
 */
export async function fetchPeopleForDashboard(
  userId: string
): Promise<PersonDashboardCard[]> {
  if (!hasSupermemory()) return [];

  const peopleTag = normalizeTag(`people_${userId}`);
  const data = await searchDocuments({
    q: "PERSON PROFILE relationships roommate manager partner friend colleague family",
    containerTags: [peopleTag],
    limit: 28,
  });

  const rows = normalizeSearchResults(data);
  const byTitle = new Map<string, { full: string; dates: string[] }>();

  for (const r of rows) {
    const text = extractResultText(r as Record<string, unknown>).trim();
    if (!text) continue;
    const meta = (r as Record<string, unknown>).metadata as
      | Record<string, unknown>
      | undefined;
    const date = meta?.date != null ? String(meta.date) : "";
    const m = text.match(/^PERSON PROFILE:\s*([^\n]+)/i);
    const title = m ? m[1].trim() : "Someone";
    const body = m ? text.slice((m.index ?? 0) + m[0].length).trim() : text;
    const prev = byTitle.get(title);
    const merged = prev ? `${prev.full}\n\n${body}` : body;
    const dates = [...(prev?.dates ?? [])];
    if (date) dates.push(date);
    byTitle.set(title, { full: merged, dates });
  }

  const cards: PersonDashboardCard[] = [];
  for (const [title, { full, dates }] of byTitle) {
    const last =
      dates.length > 0
        ? dates.sort().reverse()[0] ?? null
        : null;
    const dashParts = title.split(/\s*[—–-]\s*/);
    const baseName = dashParts[0]?.trim() || title;
    const relationship =
      dashParts.length > 1 ? dashParts.slice(1).join(" — ").trim() : undefined;
    const firstLine =
      full.split(/\n/).find((l) => l.trim().length > 0)?.trim() || full;
    cards.push({
      name: baseName,
      relationship,
      summary: firstLine.slice(0, 240),
      fullProfile: full.slice(0, 12_000),
      lastDiscussedIso: last,
    });
  }

  return cards.sort((a, b) => a.name.localeCompare(b.name));
}
