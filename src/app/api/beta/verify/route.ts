import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  ensureBetaApprovalRequest,
  isBetaBypassUserId,
} from "@/lib/beta-access";

/**
 * Internal check: is this signed-in user allowed past the beta gate?
 * Used by middleware (fetch + cookies) and optional server code.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ approved: false }, { status: 401 });
  }

  if (isBetaBypassUserId(userId)) {
    return NextResponse.json({ approved: true });
  }

  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const email =
      user.primaryEmailAddress?.emailAddress ??
      user.emailAddresses[0]?.emailAddress;

    if (!email) {
      return NextResponse.json({ approved: false, reason: "no_email" });
    }

    const ensured = await ensureBetaApprovalRequest(email);
    return NextResponse.json({ approved: ensured.status === "approved" });
  } catch (e) {
    console.error("[beta/verify]", e);
    return NextResponse.json({ approved: false }, { status: 500 });
  }
}
