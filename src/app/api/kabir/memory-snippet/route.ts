import { auth } from "@clerk/nextjs/server";
import { listKnownPeopleNames, searchMemory } from "@/lib/kabir/memory";
import { NextResponse } from "next/server";

/**
 * One-line Supermemory proof for the dashboard (server-only).
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lines = await searchMemory(
    userId,
    "What is the most important thing coming up for this person?"
  );

  const snippet = lines[0]?.trim().slice(0, 280) || null;
  const peopleNames = await listKnownPeopleNames(userId);

  return NextResponse.json({ snippet, peopleNames });
}
