"use client";

import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";

export function DashboardFooter() {
  const pathname = usePathname();

  // Session pages have their own fixed controls; avoid footer overlap entirely.
  if (pathname?.startsWith("/session/")) {
    return null;
  }

  return (
    <footer className="dashboard-shell-footer relative z-10 mx-auto max-w-5xl space-y-2 px-6 pb-10">
      <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-500">
        <Lock className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        your conversations are encrypted. they stay private.
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
  );
}
