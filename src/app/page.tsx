import { auth } from "@clerk/nextjs/server";
import { LandingHero } from "@/components/landing/LandingHero";

export default async function LandingPage() {
  const { userId } = await auth();
  return <LandingHero isSignedIn={Boolean(userId)} />;
}
