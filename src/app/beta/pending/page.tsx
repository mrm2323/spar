import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ensureBetaApprovalRequest,
  isBetaBypassUserId,
} from "@/lib/beta-access";

export default async function BetaPendingPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  if (isBetaBypassUserId(userId)) {
    redirect("/dashboard");
  }

  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const email =
      user.primaryEmailAddress?.emailAddress ??
      user.emailAddresses[0]?.emailAddress;

    if (email) {
      const ensured = await ensureBetaApprovalRequest(email);
      if (ensured.status === "approved") {
        redirect("/dashboard");
      }
    }
  } catch (e) {
    console.error("[beta/pending]", e);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#030712] px-6 text-center text-[#E2E8F0]">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">
        SPAR beta
      </p>
      <h1 className="mt-4 max-w-md text-xl font-semibold tracking-tight text-white">
        Request received
      </h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-400">
        Your access request is pending approval. When your account is approved,
        refresh this page or sign out and back in and you&apos;ll enter the app.
      </p>
      <p className="mt-6 max-w-md text-xs text-slate-500">
        Keep using this same signed-in email so we can match approval correctly.
      </p>
      <p className="mt-8 w-full max-w-md border-t border-white/[0.06] pt-8 text-xs text-slate-500">
        <a
          href="mailto:kabir.spar.ai@gmail.com"
          className="text-cyan-400/90 underline underline-offset-2 hover:text-cyan-300"
        >
          Contact us
        </a>
        {" · "}
        <Link href="/" className="text-slate-400 hover:text-slate-200">
          Home
        </Link>
      </p>
    </div>
  );
}
