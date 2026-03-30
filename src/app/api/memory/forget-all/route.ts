import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import memoryService from "@/services/memory";
import { wipeLocalUserMemoryArtifacts } from "@/lib/memory/dashboard-cache";
import { hasSupermemory } from "@/lib/kabir/memory";
import { setMemoryResetAt } from "@/lib/memory/preferences";

export const runtime = "nodejs";

export async function POST() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const local = await wipeLocalUserMemoryArtifacts(userId);
    let remoteOk = true;
    if (hasSupermemory()) {
      try {
        remoteOk = await memoryService.forgetAll(userId);
      } catch (e) {
        console.error("[memory/forget-all] supermemory", e);
        remoteOk = false;
      }
    }

    if (!local.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "Could not clear memory right now",
          supermemoryCleared: remoteOk,
        },
        { status: 500 }
      );
    }

    await setMemoryResetAt(userId, new Date().toISOString());

    return NextResponse.json({ ok: true, supermemoryCleared: remoteOk });
  } catch (error) {
    console.error("[memory/forget-all]", error);
    return NextResponse.json(
      { ok: false, error: "Memory clear failed" },
      { status: 500 }
    );
  }
}
