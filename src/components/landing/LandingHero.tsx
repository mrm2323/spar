import Link from "next/link";
import { EarlyAccessForm } from "@/app/early-access-form";
import { HeroProductMockup } from "./HeroProductMockup";

const SCENARIOS = [
  "Raises & money",
  "Hard feedback",
  "Roommates",
  "Breakups",
  "The awkward ask",
] as const;

type LandingHeroProps = {
  isSignedIn?: boolean;
};

export function LandingHero({ isSignedIn = false }: LandingHeroProps) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#030712] text-white">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(14,165,233,0.14),transparent_50%),radial-gradient(circle_at_12%_28%,rgba(34,211,238,0.1),transparent_42%),radial-gradient(circle_at_88%_62%,rgba(59,130,246,0.1),transparent_40%),linear-gradient(180deg,#030712_0%,#0a1628_42%,#030712_100%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:40px_40px]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,rgba(3,7,18,0.45)_100%)]"
        aria-hidden
      />

      <header className="relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-6 sm:py-6">
        <Link
          href="/"
          className="font-mono text-lg font-semibold tracking-[0.18em] text-cyan-200/95 transition-opacity hover:opacity-90 sm:text-xl"
        >
          SPAR
        </Link>
        <nav
          className="flex items-center gap-2 sm:gap-3"
          aria-label="Account"
        >
          {isSignedIn ? (
            <Link
              href="/dashboard/settings"
              className="rounded-lg border border-white/14 bg-white/[0.05] px-3 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-white/24 hover:bg-white/[0.08] sm:px-4"
            >
              Profile
            </Link>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="rounded-lg border border-white/12 bg-white/[0.04] px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-white/20 hover:bg-white/[0.07] hover:text-white sm:px-4"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="rounded-lg bg-gradient-to-b from-cyan-300 to-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950 shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset,0_8px_24px_rgba(34,211,238,0.22)] transition-all hover:from-cyan-200 hover:to-cyan-300 sm:px-4"
              >
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>

      <main
        id="main"
        className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-center gap-10 px-5 pb-16 pt-2 sm:gap-12 sm:px-6 sm:pb-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14 lg:pb-24 lg:pt-2"
      >
        <section
          className="animate-fade-in max-w-xl lg:max-w-[540px]"
          aria-labelledby="hero-headline"
        >
          <p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/18 bg-cyan-400/[0.06] px-3 py-1.5 text-[11px] font-medium tracking-[0.12em] text-cyan-100/90 sm:text-xs">
            <span className="h-1 w-1 rounded-full bg-cyan-400/90" />
            AI voice companion
          </p>

          <h1
            id="hero-headline"
            className="mt-6 text-[2.1rem] font-semibold leading-[1.06] tracking-tight text-white sm:text-5xl sm:leading-[1.04] lg:text-[3.1rem]"
          >
            Say it out loud
            <br />
            <span className="bg-gradient-to-r from-cyan-200 via-cyan-300 to-sky-300 bg-clip-text text-transparent">
              before the real thing.
            </span>
          </h1>

          <p className="mt-5 max-w-md text-[17px] leading-snug text-slate-200/95 sm:text-lg sm:leading-snug">
            Meet <span className="font-medium text-white">Kabir</span> — he
            plays the other side so you&apos;re not rehearsing in your head
            alone. Pushback that feels real. Notes you can actually use.
          </p>

          <p className="mt-4 text-sm italic leading-relaxed text-slate-500">
            Not another chatbot wall. One voice session at a time.
          </p>

          <div className="mt-8">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
              What&apos;s coming up?
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SCENARIOS.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1.5 text-xs text-slate-300/95 transition-colors hover:border-cyan-400/20 hover:bg-white/[0.06] sm:text-[13px]"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          <p className="mt-6 text-xs text-slate-500">
            Private · Voice-first
          </p>

          {isSignedIn ? (
            <div className="mt-10">
              <Link
                href="/dashboard"
                className="inline-flex min-h-[48px] items-center rounded-xl bg-gradient-to-b from-cyan-300 to-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-[0_0_0_1px_rgba(255,255,255,0.1)_inset,0_10px_28px_rgba(34,211,238,0.25)] transition-all hover:from-cyan-200 hover:to-cyan-400"
              >
                Open mic dashboard
              </Link>
            </div>
          ) : (
            <EarlyAccessForm />
          )}
        </section>

        <section
          className="animate-fade-in-delay-1 flex justify-center lg:justify-end"
          aria-label="Product preview"
        >
          <HeroProductMockup />
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/[0.06] bg-slate-950/40 px-5 py-5 text-center text-[11px] leading-relaxed text-slate-500 sm:px-6 sm:text-xs">
        Kabir is an AI companion — not a human coach or therapist. Built for
        when the stakes are high and the words matter.
      </footer>
    </div>
  );
}
