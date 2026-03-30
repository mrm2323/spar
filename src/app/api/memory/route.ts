import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import memoryService from "@/services/memory";
import {
  clearPatternRecognition,
  wipeLocalUserMemoryArtifacts,
} from "@/lib/memory/dashboard-cache";
import { hasSupermemory } from "@/lib/kabir/memory";
import { getMemoryPreference } from "@/lib/memory/preferences";

export const runtime = "nodejs";

type MemoryActionName =
  | "profile"
  | "remember"
  | "recall"
  | "extract"
  | "list"
  | "forget"
  | "update"
  | "forget-all"
  | "clear-patterns";

function normalizeActionName(raw: unknown): MemoryActionName | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value === "forget-all" || value === "clear-patterns") return value;
  if (value === "clear-memory" || value === "clear all" || value === "reset-memory") {
    return "forget-all";
  }
  if (value === "reset-patterns" || value === "clear-pattern-recognition") {
    return "clear-patterns";
  }
  if (
    value === "profile" ||
    value === "remember" ||
    value === "recall" ||
    value === "extract" ||
    value === "list" ||
    value === "forget" ||
    value === "update"
  ) {
    return value;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<
      string,
      unknown
    >;
    const {
      query,
      currentContext,
      content,
      category,
      metadata,
      messages,
      limit,
      memoryId,
      newContent,
    } = body;

    const action = normalizeActionName(body.action ?? req.nextUrl.searchParams.get("action"));

    const queryText = typeof query === "string" ? query : "";
    const currentContextText =
      typeof currentContext === "string" ? currentContext : "";
    const contentText = typeof content === "string" ? content : "";
    const categoryText = typeof category === "string" ? category : undefined;
    const metadataObj =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    const messagesList = Array.isArray(messages) ? messages : [];
    const limitNumber =
      typeof limit === "number"
        ? limit
        : typeof limit === "string"
          ? Number(limit) || 0
          : 0;
    const memoryIdText = typeof memoryId === "string" ? memoryId : "";
    const newContentText = typeof newContent === "string" ? newContent : "";

    if (!action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    const memoryEnabled = await getMemoryPreference(userId);

    switch (action) {
      case "profile": {
        if (!memoryEnabled) {
          return NextResponse.json({
            profile: { staticFacts: [], dynamicContext: [], relevantMemories: [] },
            context: "",
            hasMemories: false,
            disabled: true,
          });
        }
        const profile = await memoryService.getProfile(userId, currentContextText);
        return NextResponse.json({
          profile,
          context: memoryService.formatMemoriesForPrompt(profile),
          hasMemories: memoryService.hasPersonalization(profile),
        });
      }
      case "remember": {
        if (!memoryEnabled) return NextResponse.json({ ok: false, disabled: true });
        const result = await memoryService.remember(
          userId,
          contentText,
          categoryText,
          metadataObj
        );
        return NextResponse.json({ ok: !!result });
      }
      case "recall": {
        if (!memoryEnabled) return NextResponse.json({ memories: [], disabled: true });
        const memories = await memoryService.recall(userId, queryText, {
          limit: limitNumber || 5,
        });
        return NextResponse.json({ memories });
      }
      case "extract": {
        if (!memoryEnabled) return NextResponse.json({ facts: [], disabled: true });
        const facts = await memoryService.extractAndRemember(userId, messagesList);
        return NextResponse.json({ facts });
      }
      case "list": {
        const memories = await memoryService.listMemories(userId, {
          query: queryText,
          limit: limitNumber || 30,
        });
        return NextResponse.json({ memories });
      }
      case "forget": {
        if (!memoryIdText) {
          return NextResponse.json({ error: "memoryId is required" }, { status: 400 });
        }
        const ok = await memoryService.forget(userId, memoryIdText);
        return NextResponse.json({ ok });
      }
      case "update": {
        if (!memoryIdText || !newContentText) {
          return NextResponse.json(
            { error: "memoryId and newContent are required" },
            { status: 400 }
          );
        }
        const result = await memoryService.updateMemory(
          userId,
          memoryIdText,
          newContentText,
          categoryText,
          metadataObj
        );
        return NextResponse.json({ ok: !!result, memory: result || null });
      }
      case "forget-all": {
        const local = await wipeLocalUserMemoryArtifacts(userId);
        let remoteOk = true;
        if (hasSupermemory()) {
          try {
            remoteOk = await memoryService.forgetAll(userId);
          } catch (e) {
            console.error("[memory] forget-all supermemory", e);
            remoteOk = false;
          }
        }
        return NextResponse.json({
          ok: local.ok,
          supermemoryCleared: remoteOk,
        });
      }
      case "clear-patterns": {
        const { ok } = await clearPatternRecognition(userId);
        return NextResponse.json({ ok });
      }
      default:
        return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Memory API error:", error);
    return NextResponse.json({ error: "Memory API request failed" }, { status: 500 });
  }
}
