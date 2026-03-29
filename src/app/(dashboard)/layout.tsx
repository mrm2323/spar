import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { DashboardNavExtras } from "@/components/dashboard/DashboardNavExtras";
import { DashboardFooter } from "./dashboard-footer";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0A0A0F]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(56,189,248,0.09),transparent_50%),radial-gradient(ellipse_60%_40%_at_100%_0%,rgba(167,139,250,0.06),transparent_45%),linear-gradient(180deg,#0A0A0F_0%,#0f0f17_50%,#0A0A0F_100%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-[0.05] [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:34px_34px]" />

      <nav className="fixed top-0 z-50 w-full border-b border-white/[0.06] bg-[#0A0A0F]/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link
            href="/"
            className="font-mono text-sm font-semibold tracking-[0.14em] text-cyan-400/95"
          >
            spar
          </Link>
          <div className="flex items-center gap-3">
            <DashboardNavExtras />
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
