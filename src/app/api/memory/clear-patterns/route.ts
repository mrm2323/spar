import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { clearPatternRecognition } from "@/lib/memory/dashboard-cache";

export const runtime = "nodejs";

export async function POST() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { ok } = await clearPatternRecognition(userId);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "Could not reset patterns right now" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[memory/clear-patterns]", error);
    return NextResponse.json(
      { ok: false, error: "Pattern reset failed" },
      { status: 500 }
    );
  }
}
