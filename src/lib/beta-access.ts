import { createSupabaseAdmin } from "@/lib/supabase/server";

/** Normalize email for waitlist + approval checks. */
export function normalizeBetaEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Clerk user IDs that always pass the beta gate (owners / internal).
 * Same pattern as SPAR_CAP_EXEMPT_USER_IDS — comma-separated in .env.local
 */
export function isBetaBypassUserId(userId: string): boolean {
  const raw = process.env.SPAR_BETA_BYPASS_USER_IDS?.trim();
  if (!raw) return false;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(userId);
}

export async function isEmailBetaApproved(email: string): Promise<boolean> {
  const normalized = normalizeBetaEmail(email);
  if (!normalized || !normalized.includes("@")) return false;

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("beta_waitlist")
    .select("id")
    .eq("email", normalized)
    .eq("status", "approved")
    .maybeSingle();

  if (error) {
    console.error("[beta-access] lookup failed:", error.message);
    return false;
  }
  return !!data;
}
