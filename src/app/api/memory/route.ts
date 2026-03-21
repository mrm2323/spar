import { NextRequest, NextResponse } from "next/server";
import memoryService from "@/services/memory";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { action, userId, query, currentContext, content, category, metadata, messages, limit } =
      await req.json();

    if (!action || !userId) {
      return NextResponse.json({ error: "action and userId are required" }, { status: 400 });
    }

    switch (action) {
      case "profile": {
        const profile = await memoryService.getProfile(userId, currentContext || "");
        return NextResponse.json({
          profile,
          context: memoryService.formatMemoriesForPrompt(profile),
          hasMemories: memoryService.hasPersonalization(profile),
        });
      }
      case "remember": {
        const result = await memoryService.remember(userId, content, category, metadata || {});
        return NextResponse.json({ ok: !!result });
      }
      case "recall": {
        const memories = await memoryService.recall(userId, query || "", { limit: limit || 5 });
        return NextResponse.json({ memories });
      }
      case "extract": {
        const facts = await memoryService.extractAndRemember(userId, messages || []);
        return NextResponse.json({ facts });
      }
      case "forget-all": {
        const ok = await memoryService.forgetAll(userId);
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
