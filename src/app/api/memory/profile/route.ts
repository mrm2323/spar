import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasSupermemory } from "@/lib/kabir/memory";
import { getOrBuildDashboardCache } from "@/lib/memory/dashboard-cache";

export const runtime = "nodejs";

/**
 * Cached communicator portrait + patterns for Memory dashboard.
 */
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await getOrBuildDashboardCache(userId);
    return NextResponse.json({
      portrait: data.profileText,
      patterns: data.patterns,
      sessionCount: data.sessionCount,
      generatedAt: data.generatedAt,
      cached: data.cacheHit,
      supermemoryConfigured: hasSupermemory(),
    });
  } catch (e) {
    console.error("[memory/profile]", e);
    return NextResponse.json(
      { error: "Could not load memory profile" },
      { status: 500 }
    );
  }
}
