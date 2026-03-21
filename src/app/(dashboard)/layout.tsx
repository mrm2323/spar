import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Lock } from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0A0A0F]">
      <nav className="fixed top-0 z-50 w-full border-b border-zinc-900/80 bg-[#0A0A0F]/90 backdrop-blur-md">
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
      <main className="mx-auto max-w-5xl px-6 pt-20 pb-8">{children}</main>
      <footer className="mx-auto max-w-5xl px-6 pb-10">
        <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-zinc-600">
          <Lock className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
          End-to-end encrypted. Your conversations are private.
        </p>
      </footer>
    </div>
  );
}
