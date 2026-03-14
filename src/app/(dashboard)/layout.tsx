import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-950">
      <nav className="fixed top-0 z-50 w-full bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link
            href="/dashboard"
            className="text-lg font-semibold tracking-tight text-white"
          >
            spar
          </Link>
          <UserButton
            appearance={{
              elements: {
                avatarBox: "h-8 w-8",
              },
            }}
          />
        </div>
      </nav>
      <main className="mx-auto max-w-5xl px-6 pt-20 pb-16">{children}</main>
    </div>
  );
}
