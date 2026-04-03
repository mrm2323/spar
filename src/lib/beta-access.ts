import { createSupabaseAdmin } from "@/lib/supabase/server";
import { notifyWaitlistSignup } from "@/lib/waitlist-notify";

/** Normalize email for access-request and approval checks. */
export function normalizeBetaEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type BetaWaitlistStatus = "approved" | "pending" | "rejected" | "none";

type EnsureBetaRequestResult = {
  status: BetaWaitlistStatus;
  requestCreated: boolean;
  requestReopened: boolean;
};

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

/**
 * Ensures a signed-in email has an approval request row.
 * - missing row => create pending + notify owner
 * - rejected row => reopen to pending (no notify)
 * - approved/pending => no write
 */
export async function ensureBetaApprovalRequest(
  email: string
): Promise<EnsureBetaRequestResult> {
  const normalized = normalizeBetaEmail(email);
  if (!normalized || !normalized.includes("@")) {
    return { status: "none", requestCreated: false, requestReopened: false };
  }

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("beta_waitlist")
    .select("status")
    .eq("email", normalized)
    .maybeSingle();

  if (error) {
    console.error("[beta-access] lookup failed:", error.message);
    return { status: "none", requestCreated: false, requestReopened: false };
  }

  const existing = data?.status;
  if (existing === "approved" || existing === "pending") {
    return { status: existing, requestCreated: false, requestReopened: false };
  }

  if (existing === "rejected") {
    const { error: updateError } = await supabase
      .from("beta_waitlist")
      .update({
        status: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("email", normalized);

    if (updateError) {
      console.error("[beta-access] reopen failed:", updateError.message);
      return { status: "rejected", requestCreated: false, requestReopened: false };
    }

    return { status: "pending", requestCreated: false, requestReopened: true };
  }

  const { error: insertError } = await supabase.from("beta_waitlist").insert({
    email: normalized,
    status: "pending",
  });

  // 23505 = unique_violation; row created in parallel request.
  if (insertError?.code === "23505") {
    const status = await getEmailBetaStatus(normalized);
    return { status, requestCreated: false, requestReopened: false };
  }

  if (insertError) {
    console.error("[beta-access] create request failed:", insertError.message);
    return { status: "none", requestCreated: false, requestReopened: false };
  }

  void notifyWaitlistSignup(normalized).catch((err) => {
    console.error("[beta-access] notify signup failed:", err);
  });

  return { status: "pending", requestCreated: true, requestReopened: false };
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
