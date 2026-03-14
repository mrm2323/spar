import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ sessions: [] });
  }

  const supabase = createSupabaseAdmin();

  // Get the user's linked phone number
  const { data: memory } = await supabase
    .from("user_memory")
    .select("phone_number")
    .eq("user_id", userId)
    .single();

  // Build list of user IDs to query (Clerk ID + phone:number if linked)
  const userIds = [userId];
  if (memory?.phone_number) {
    userIds.push(`phone:${memory.phone_number}`);
  }

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, context, ended_at, duration_seconds, user_id")
    .in("user_id", userIds)
    .eq("status", "completed")
    .order("ended_at", { ascending: false })
    .limit(20);

  return NextResponse.json({ sessions: sessions || [] });
}
