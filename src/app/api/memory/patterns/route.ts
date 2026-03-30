import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getOrBuildDashboardCache } from "@/lib/memory/dashboard-cache";
import { getMemoryResetAt } from "@/lib/memory/preferences";

export const runtime = "nodejs";

/**
 * Pattern cards (same cache as GET /api/memory/profile).
 */
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resetAfterIso = await getMemoryResetAt(userId);
    const data = await getOrBuildDashboardCache(userId, { resetAfterIso });
    return NextResponse.json({
      patterns: data.patterns,
      generatedAt: data.generatedAt,
      cached: data.cacheHit,
    });
  } catch (e) {
    console.error("[memory/patterns]", e);
    return NextResponse.json(
      { error: "Could not load patterns" },
      { status: 500 }
    );
  }
}
