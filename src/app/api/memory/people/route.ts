import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { fetchPeopleForDashboard, hasSupermemory } from "@/lib/kabir/memory";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!hasSupermemory()) {
      return NextResponse.json({ people: [], supermemoryConfigured: false });
    }

    const people = await fetchPeopleForDashboard(userId);
    return NextResponse.json({
      people,
      supermemoryConfigured: true,
    });
  } catch (e) {
    console.error("[memory/people]", e);
    return NextResponse.json(
      { error: "Could not load people" },
      { status: 500 }
    );
  }
}
