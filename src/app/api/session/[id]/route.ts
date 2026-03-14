import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { vapiCallId } = (await req.json()) as { vapiCallId: string };
  if (!vapiCallId) {
    return NextResponse.json({ error: "Missing vapiCallId" }, { status: 400 });
  }

  const supabase = createSupabaseAdmin();
  await supabase
    .from("sessions")
    .update({ vapi_call_id: vapiCallId })
    .eq("id", sessionId)
    .eq("user_id", userId);

  return NextResponse.json({ success: true });
}
