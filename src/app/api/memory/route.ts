import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import memoryService from "@/services/memory";
import { deleteUserMemoryCache } from "@/lib/memory/dashboard-cache";
import { getMemoryPreference } from "@/lib/memory/preferences";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      action,
      query,
      currentContext,
      content,
      category,
      metadata,
      messages,
      limit,
      memoryId,
      newContent,
    } = await req.json();

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
        const profile = await memoryService.getProfile(userId, currentContext || "");
        return NextResponse.json({
          profile,
          context: memoryService.formatMemoriesForPrompt(profile),
          hasMemories: memoryService.hasPersonalization(profile),
        });
      }
      case "remember": {
        if (!memoryEnabled) return NextResponse.json({ ok: false, disabled: true });
        const result = await memoryService.remember(userId, content, category, metadata || {});
        return NextResponse.json({ ok: !!result });
      }
      case "recall": {
        if (!memoryEnabled) return NextResponse.json({ memories: [], disabled: true });
        const memories = await memoryService.recall(userId, query || "", { limit: limit || 5 });
        return NextResponse.json({ memories });
      }
      case "extract": {
        if (!memoryEnabled) return NextResponse.json({ facts: [], disabled: true });
        const facts = await memoryService.extractAndRemember(userId, messages || []);
        return NextResponse.json({ facts });
      }
      case "list": {
        const memories = await memoryService.listMemories(userId, {
          query: query || "",
          limit: limit || 30,
        });
        return NextResponse.json({ memories });
      }
      case "forget": {
        if (!memoryId) {
          return NextResponse.json({ error: "memoryId is required" }, { status: 400 });
        }
        const ok = await memoryService.forget(userId, memoryId);
        return NextResponse.json({ ok });
      }
      case "update": {
        if (!memoryId || !newContent) {
          return NextResponse.json(
            { error: "memoryId and newContent are required" },
            { status: 400 }
          );
        }
        const result = await memoryService.updateMemory(
          userId,
          memoryId,
          newContent,
          category,
          metadata || {}
        );
        return NextResponse.json({ ok: !!result, memory: result || null });
      }
      case "forget-all": {
        const ok = await memoryService.forgetAll(userId);
        await deleteUserMemoryCache(userId);
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
