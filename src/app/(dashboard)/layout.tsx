import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Lock } from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#020617]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(14,165,233,0.12),transparent_35%),radial-gradient(circle_at_82%_70%,rgba(59,130,246,0.12),transparent_38%),linear-gradient(180deg,#020617_0%,#08142a_50%,#020617_100%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:34px_34px]" />

      <nav className="fixed top-0 z-50 w-full border-b border-slate-800/70 bg-[#050c1d]/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight text-cyan-300"
          >
            spar
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard/settings"
              className="text-xs font-medium uppercase tracking-wider text-slate-300 transition-colors hover:text-cyan-300"
            >
              Memory
            </Link>
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "h-8 w-8",
                },
              }}
            />
          </div>
        </div>
      </nav>
      <main className="relative z-10 mx-auto max-w-5xl px-6 pt-20 pb-8">{children}</main>
      <footer className="relative z-10 mx-auto max-w-5xl space-y-2 px-6 pb-10">
        <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-500">
          <Lock className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
          End-to-end encrypted. Your conversations are private.
        </p>
        <p className="text-center text-[11px] text-slate-500">
          <a
            href="mailto:kabir.spar.ai@gmail.com"
            className="text-slate-400 underline decoration-slate-600 underline-offset-2 transition-colors hover:text-cyan-400"
          >
            Contact us
          </a>
          <span className="text-slate-600"> · </span>
          <span className="text-slate-500">kabir.spar.ai@gmail.com</span>
        </p>
      </footer>
    </div>
  );
}
