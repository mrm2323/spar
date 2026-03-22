import { createSupabaseAdmin } from "@/lib/supabase/server";

/** Normalize email for waitlist + approval checks. */
export function normalizeBetaEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type BetaWaitlistStatus = "approved" | "pending" | "rejected" | "none";

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
  const status = await getEmailBetaStatus(email);
  return status === "approved";
}

export async function getEmailBetaStatus(email: string): Promise<BetaWaitlistStatus> {
  const normalized = normalizeBetaEmail(email);
  if (!normalized || !normalized.includes("@")) return "none";

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("beta_waitlist")
    .select("status")
    .eq("email", normalized)
    .maybeSingle();

  if (error) {
    console.error("[beta-access] lookup failed:", error.message);
    return "none";
  }

  const status = data?.status;
  if (status === "approved" || status === "pending" || status === "rejected") {
    return status;
  }
  return "none";
}
