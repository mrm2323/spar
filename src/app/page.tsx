import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { GenZLanding } from "@/components/landing/GenZLanding";
import {
  getEmailBetaStatus,
  isBetaBypassUserId,
  type BetaWaitlistStatus,
} from "@/lib/beta-access";

export default async function LandingPage() {
  const { userId } = await auth();

  if (!userId) {
    return (
      <GenZLanding
        isSignedIn={false}
        isApproved={false}
        waitlistStatus="unknown"
        completedSessionCount={0}
      />
    );
  }

  let isApproved = false;
  let waitlistStatus: BetaWaitlistStatus | "unknown" = "unknown";

  if (isBetaBypassUserId(userId)) {
    isApproved = true;
    waitlistStatus = "approved";
  } else {
    try {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      const email =
        user.primaryEmailAddress?.emailAddress ??
        user.emailAddresses[0]?.emailAddress ??
        "";

      if (email) {
        waitlistStatus = await getEmailBetaStatus(email);
        isApproved = waitlistStatus === "approved";
      }
    } catch (e) {
      console.error("[landing] beta status check failed", e);
      isApproved = false;
      waitlistStatus = "unknown";
    }
  }

  let completedSessionCount = 0;
  try {
    const supabase = createSupabaseAdmin();
    const { count } = await supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "completed");
    completedSessionCount = typeof count === "number" ? count : 0;
  } catch (e) {
    console.error("[landing] session count", e);
  }

  return (
    <GenZLanding
      isSignedIn={true}
      isApproved={isApproved}
      waitlistStatus={waitlistStatus}
      completedSessionCount={completedSessionCount}
    />
  );
}
