import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { generateKabirNotes } from "@/lib/forensics/generate";
import { sessionBelongsToUser } from "@/lib/session-access";
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
  const allowed = await sessionBelongsToUser(supabase, sessionId, userId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdmin();
  const allowed = await sessionBelongsToUser(supabase, sessionId, userId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let forceRegenerate = false;
  try {
    const body = (await req.json()) as { regenerate?: boolean };
    forceRegenerate = Boolean(body?.regenerate);
  } catch {
    /* no JSON body — first-time generate */
  }

  console.log(
    "[FORENSICS API] POST — session:",
    sessionId,
    forceRegenerate ? "(regenerate)" : "(generate if missing)"
  );

  const result = await generateKabirNotes(sessionId, userId, {
    forceRegenerate,
  });

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

  return NextResponse.json({
    status: "ready",
    notes: result.notes,
    fromCache: result.fromCache,
    regenerated: forceRegenerate && !result.fromCache,
  });
}
