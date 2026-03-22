import { createSupabaseAdmin } from "@/lib/supabase/server";
import { getSessionUserIds } from "@/lib/session-access";

export const FREE_SESSION_CAP_SECONDS = 15 * 60;
export const DEFAULT_SESSION_MAX_SECONDS = 10 * 60;

type AdminClient = ReturnType<typeof createSupabaseAdmin>;

type SessionUsageRow = {
  id: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
};

function toDurationSeconds(row: SessionUsageRow, nowMs: number): number {
  if (typeof row.duration_seconds === "number" && Number.isFinite(row.duration_seconds)) {
    return Math.max(0, Math.round(row.duration_seconds));
  }

  const startedMs = row.started_at ? Date.parse(row.started_at) : NaN;
  if (!Number.isFinite(startedMs)) return 0;

  if (row.status === "active") {
    return Math.max(0, Math.round((nowMs - startedMs) / 1000));
  }

  const endedMs = row.ended_at ? Date.parse(row.ended_at) : NaN;
  if (!Number.isFinite(endedMs)) return 0;

  return Math.max(0, Math.round((endedMs - startedMs) / 1000));
}

/**
 * Get next reset time (10 am UTC today or tomorrow)
 */
function getNextResetTime(): Date {
  const now = new Date();
  const reset = new Date(now);
  reset.setUTCHours(10, 0, 0, 0);
  
  // If we've already passed 10 am UTC today, reset is tomorrow
  if (now > reset) {
    reset.setUTCDate(reset.getUTCDate() + 1);
  }
  
  return reset;
}

/**
 * Get the most recent reset that should apply to the user
 */
function getMostRecentResetTime(): Date {
  const now = new Date();
  const reset = new Date(now);
  reset.setUTCHours(10, 0, 0, 0);
  
  // If we haven't reached 10 am UTC today, the reset was yesterday
  if (now < reset) {
    reset.setUTCDate(reset.getUTCDate() - 1);
  }
  
  return reset;
}

export async function getUserSessionUsage(
  supabase: AdminClient,
  userId: string,
  opts?: {
    includeActive?: boolean;
    excludeSessionId?: string | null;
  }
) {
  const includeActive = opts?.includeActive ?? true;
  const excludeSessionId = opts?.excludeSessionId || null;

  const userIds = await getSessionUserIds(supabase, userId);
  
  let resetCutoff = getMostRecentResetTime();
  
  // Try to get user's last reset time (gracefully fall back if column doesn't exist yet)
  try {
    const { data: userReset, error: resetError } = await supabase
      .from("users")
      .select("daily_cap_reset_at")
      .in("id", userIds)
      .single();

    if (!resetError && userReset?.daily_cap_reset_at) {
      const userResetDate = new Date(userReset.daily_cap_reset_at);
      const calculatedReset = getMostRecentResetTime();
      
      // Use the later of the two reset times
      if (userResetDate > calculatedReset) {
        resetCutoff = userResetDate;
      }
      
      // Check if we need to update the reset timestamp (only if user hasn't reset today)
      if (userResetDate < calculatedReset) {
        try {
          await supabase
            .from("users")
            .update({ daily_cap_reset_at: calculatedReset.toISOString() })
            .in("id", userIds);
        } catch {
          /* Silently ignore update errors */
        }
        resetCutoff = calculatedReset;
      }
    }
  } catch {
    // Migration not yet applied - just use calculated reset time
    resetCutoff = getMostRecentResetTime();
  }

  const { data, error } = await supabase
    .from("sessions")
    .select("id, status, started_at, ended_at, duration_seconds")
    .in("user_id", userIds)
    .in("status", includeActive ? ["active", "completed"] : ["completed"])
    .gte("started_at", resetCutoff.toISOString());

  if (error) {
    throw new Error(`Failed to fetch usage: ${error.message}`);
  }

  const nowMs = Date.now();
  const rows = (data || []).filter((row) => row.id !== excludeSessionId);
  const usedSeconds = rows.reduce((sum, row) => {
    return sum + toDurationSeconds(row as SessionUsageRow, nowMs);
  }, 0);

  const remainingSeconds = Math.max(0, FREE_SESSION_CAP_SECONDS - usedSeconds);

  return {
    capSeconds: FREE_SESSION_CAP_SECONDS,
    usedSeconds,
    remainingSeconds,
    usedMinutes: Number((usedSeconds / 60).toFixed(2)),
    remainingMinutes: Number((remainingSeconds / 60).toFixed(2)),
    usagePercent: Number(((usedSeconds / FREE_SESSION_CAP_SECONDS) * 100).toFixed(1)),
    nextResetTime: getNextResetTime().toISOString(),
  };
}

export function getAllowedSessionSeconds(remainingSeconds: number): number {
  return Math.max(0, Math.min(DEFAULT_SESSION_MAX_SECONDS, remainingSeconds));
}

export function formatRemainingTime(remainingSeconds: number): string {
  const safe = Math.max(0, Math.floor(remainingSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  if (minutes === 0) return `${seconds} sec`;
  return `${minutes} min ${seconds.toString().padStart(2, "0")} sec`;
}
