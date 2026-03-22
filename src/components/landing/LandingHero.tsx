import Link from "next/link";
import { EarlyAccessForm } from "@/app/early-access-form";
import { HeroProductMockup } from "./HeroProductMockup";

const SCENARIOS = [
  "Salary & raises",
  "Hard feedback",
  "Roommate boundaries",
  "Breakups & tough talks",
  "Asks that feel awkward",
] as const;

export function LandingHero() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#030712] text-white">
      {/* Background: deep navy + soft cyan/blue radials + grid */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(14,165,233,0.15),transparent_50%),radial-gradient(circle_at_12%_28%,rgba(34,211,238,0.12),transparent_42%),radial-gradient(circle_at_88%_62%,rgba(59,130,246,0.12),transparent_40%),linear-gradient(180deg,#030712_0%,#0a1628_42%,#030712_100%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:40px_40px]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,rgba(3,7,18,0.4)_100%)]"
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
        </nav>
      </header>

      <main
        id="main"
        className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-center gap-12 px-5 pb-16 pt-2 sm:px-6 sm:pb-20 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:gap-16 lg:pb-24 lg:pt-4"
      >
        {/* Copy column */}
        <section
          className="animate-fade-in max-w-xl lg:max-w-none"
          aria-labelledby="hero-headline"
        >
          <p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/[0.07] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-200/95 sm:text-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
            AI voice practice
          </p>

          <h1
            id="hero-headline"
            className="mt-5 text-[2rem] font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl sm:leading-[1.06] lg:text-[3.25rem] lg:leading-[1.05]"
          >
            Practice the difficult conversation{" "}
            <span className="bg-gradient-to-r from-cyan-200 via-cyan-300 to-sky-300 bg-clip-text text-transparent">
              before it happens
            </span>
            .
          </h1>

          <p className="mt-6 text-base leading-relaxed text-slate-300/95 sm:text-lg sm:leading-relaxed">
            <strong className="font-semibold text-slate-100">
              SPAR is an AI voice coach.
            </strong>{" "}
            You speak out loud. An AI persona roleplays the other person—with
            realistic pushback—then gives you clear coaching so you sound steady
            when it counts.
          </p>

          <ul className="mt-6 flex flex-col gap-2 text-sm text-slate-400/95 sm:text-[15px]">
            <li className="flex gap-2">
              <span className="text-cyan-400/90" aria-hidden>
                ✓
              </span>
              Voice session, not a chatbot wall of text
            </li>
            <li className="flex gap-2">
              <span className="text-cyan-400/90" aria-hidden>
                ✓
              </span>
              The other side pushes back like a real conversation
            </li>
            <li className="flex gap-2">
              <span className="text-cyan-400/90" aria-hidden>
                ✓
              </span>
              Feedback you can use in the real meeting the same day
            </li>
          </ul>

          <div className="mt-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:text-xs">
              Practice scenarios
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SCENARIOS.map((label) => (
                <span
                  key={label}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-200/90 transition-colors hover:border-cyan-400/25 hover:bg-white/[0.07] sm:text-sm"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500 sm:text-sm">
            <span>Private session</span>
            <span className="hidden text-slate-600 sm:inline" aria-hidden>
              ·
            </span>
            <span>Built for high-stakes moments</span>
            <span className="hidden text-slate-600 sm:inline" aria-hidden>
              ·
            </span>
            <span>Kabir = AI persona, not a human coach</span>
          </div>

          <EarlyAccessForm />
        </section>

        {/* Product mockup column */}
        <section
          className="animate-fade-in-delay-1 flex justify-center lg:justify-end"
          aria-label="Product preview"
        >
          <HeroProductMockup />
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/[0.08] bg-slate-950/50 px-5 py-5 text-center text-xs leading-relaxed text-slate-500 sm:px-6">
        Built for anyone who has to find the words when the stakes are high.
      </footer>
    </div>
  );
}
