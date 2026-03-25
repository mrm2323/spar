import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { DashboardFooter } from "./dashboard-footer";

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
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/memory"
              className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs font-medium text-cyan-100 transition-colors hover:border-cyan-300/50 hover:bg-cyan-400/20"
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
      <main className="dashboard-shell-main relative z-10 mx-auto max-w-5xl px-6 pt-20 pb-8">{children}</main>
      <DashboardFooter />
    </div>
  );
}
