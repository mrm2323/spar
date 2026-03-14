import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  return digits.startsWith("+") ? raw.trim() : `+${digits}`;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdmin();
  const { data } = await supabase
    .from("user_memory")
    .select("phone_number")
    .eq("user_id", userId)
    .single();

  return NextResponse.json({ phone: data?.phone_number || null });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { phone } = (await req.json()) as { phone: string };
  if (!phone || phone.trim().length < 7) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
  }

  const normalized = normalizePhone(phone);
  const supabase = createSupabaseAdmin();

  const { data: existing } = await supabase
    .from("user_memory")
    .select("id")
    .eq("user_id", userId)
    .single();

  if (existing) {
    await supabase
      .from("user_memory")
      .update({ phone_number: normalized, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  } else {
    await supabase.from("user_memory").insert({
      user_id: userId,
      phone_number: normalized,
      total_sessions: 0,
    });
  }

  // Retroactively link any existing phone sessions to this user
  await supabase
    .from("sessions")
    .update({ user_id: userId })
    .eq("user_id", `phone:${normalized}`);

  // Also link forensics reports for those sessions
  const { data: phoneSessions } = await supabase
    .from("sessions")
    .select("id")
    .eq("user_id", userId)
    .is("ended_at", null)
    .not("vapi_call_id", "is", null);

  if (phoneSessions) {
    for (const s of phoneSessions) {
      await supabase
        .from("forensics_reports")
        .update({ user_id: userId })
        .eq("session_id", s.id);
    }
  }

  // Also update any forensics_reports that had phone:number as user_id
  await supabase
    .from("forensics_reports")
    .update({ user_id: userId })
    .eq("user_id", `phone:${normalized}`);

  return NextResponse.json({ success: true, phone: normalized });
}
