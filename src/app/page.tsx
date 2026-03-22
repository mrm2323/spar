import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { LandingHero } from "@/components/landing/LandingHero";
import {
  getEmailBetaStatus,
  isBetaBypassUserId,
  type BetaWaitlistStatus,
} from "@/lib/beta-access";

export default async function LandingPage() {
  const { userId } = await auth();

  if (!userId) {
    return <LandingHero isSignedIn={false} isApproved={false} />;
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

  return (
    <LandingHero
      isSignedIn={true}
      isApproved={isApproved}
      waitlistStatus={waitlistStatus}
    />
  );
}
