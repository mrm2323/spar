import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import {
  generateKabirNotes,
  generateMemoryUpdate,
} from "@/lib/forensics/generate";
import { after } from "next/server";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdmin();

  const { data: report } = await supabase
    .from("forensics_reports")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!report) {
    return NextResponse.json({ status: "pending" }, { status: 202 });
  }

  return NextResponse.json({ status: "ready", report });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[FORENSICS API] POST — generating notes for session:", sessionId);

  const result = await generateKabirNotes(sessionId, userId);

  if (!result) {
    console.log("[FORENSICS API] No result (likely no transcript yet)");
    return NextResponse.json(
      { error: "No transcript available yet" },
      { status: 400 }
    );
  }

  console.log(
    "[FORENSICS API] Notes ready, fromCache:",
    result.fromCache
  );

  if (!result.fromCache) {
    after(async () => {
      try {
        await generateMemoryUpdate(sessionId, userId);
      } catch (err) {
        console.error("[FORENSICS API] Memory update error:", err);
      }
    });
  }

  return NextResponse.json({
    status: "ready",
    notes: result.notes,
  });
}
