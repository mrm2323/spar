import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/lib/kabir/system-prompt";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { context } = body as { context: string | null };

    const supabase = createSupabaseAdmin();

    const { data: memory, error: memoryError } = await supabase
      .from("user_memory")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (memoryError) {
      console.log("No existing memory (expected for new users):", memoryError.code);
    }

    const systemPrompt = buildSystemPrompt(context, memory);

    const { data: session, error } = await supabase
      .from("sessions")
      .insert({
        user_id: userId,
        scenario: "high_stakes",
        context,
        status: "active",
      })
      .select("id")
      .single();

    if (error || !session) {
      console.error("Session insert failed:", error);
      return NextResponse.json(
        { error: "Failed to create session", details: error?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      sessionId: session.id,
      systemPrompt,
    });
  } catch (err) {
    console.error("Session start error:", err);
    return NextResponse.json(
      { error: "Internal error", details: String(err) },
      { status: 500 }
    );
  }
}
