import { createSupabaseAdmin } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createSupabaseAdmin>;

export async function getSessionUserIds(
  supabase: AdminClient,
  userId: string
): Promise<string[]> {
  const { data: memory } = await supabase
    .from("user_memory")
    .select("phone_number")
    .eq("user_id", userId)
    .maybeSingle();

  const userIds = [userId];
  if (memory?.phone_number) {
    userIds.push(`phone:${memory.phone_number}`);
  }
  return userIds;
}

export async function sessionBelongsToUser(
  supabase: AdminClient,
  sessionId: string,
  userId: string
): Promise<boolean> {
  const userIds = await getSessionUserIds(supabase, userId);
  const { data: row } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", sessionId)
    .in("user_id", userIds)
    .maybeSingle();
  return !!row;
}
