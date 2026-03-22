import { EarlyAccessForm } from "./early-access-form";
import Link from "next/link";
import { Mic } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#020617] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(14,165,233,0.22),transparent_35%),radial-gradient(circle_at_80%_55%,rgba(59,130,246,0.18),transparent_36%),linear-gradient(180deg,#020617_0%,#08142a_48%,#020617_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.09] [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:34px_34px]" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <p className="font-mono text-xl font-semibold tracking-[0.16em] text-cyan-300">SPAR</p>
        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-cyan-300/40 hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300"
          >
            Sign up
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-6 py-10 sm:py-12 lg:grid-cols-[1.05fr_0.95fr] lg:py-16">
        <section>
          <h1 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tight text-cyan-300 sm:text-5xl lg:text-6xl">
            Call Kabir before the conversation you&apos;re looking forward to.
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-300/85 sm:text-lg">
            He&apos;ll become the other person. He&apos;ll push you. Then he&apos;ll tell you exactly what to fix.
          </p>

          <div className="mt-8 flex flex-wrap gap-3 text-sm text-slate-300/75">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">Your roommate talk</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">Your salary ask</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">The thing you&apos;ve been putting off</span>
          </div>

          {/* Client-side submit so we never leave the app. */}
          {/* eslint-disable-next-line @next/next/no-before-interactive-script-outside-document */}
          <EarlyAccessForm />
        </section>

        <section className="relative mx-auto w-full max-w-xl">
          <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-br from-cyan-400/20 via-blue-500/10 to-cyan-300/10 blur-3xl" />
          <div className="relative rounded-[2rem] border border-white/10 bg-slate-900/65 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.55)] backdrop-blur-xl sm:p-7">
            <div className="mx-auto max-w-[320px] rounded-[2.4rem] border border-white/10 bg-[#08111d] p-3">
              <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(12,23,41,0.98),rgba(6,12,22,0.98))] px-5 pb-6 pt-4">
                <div className="mx-auto mb-5 h-1.5 w-20 rounded-full bg-white/10" />
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Kabir</p>
                    <p className="mt-1 text-sm text-slate-400">Live voice session</p>
                  </div>
                </div>

                <div className="relative mx-auto mb-6 flex h-44 w-44 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-400/5">
                  <span className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-400/25 to-blue-500/15 blur-2xl" />
                  <div className="relative z-10 flex flex-col items-center">
                    <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-cyan-500 text-slate-950 shadow-[0_0_24px_rgba(56,189,248,0.45)]">
                      <Mic className="h-8 w-8" />
                    </div>
                    <div className="flex items-end gap-1">
                      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                        <span
                          key={i}
                          className="animate-waveform w-1.5 rounded-full bg-cyan-300/90"
                          style={{
                            height: `${8 + (i % 3) * 5}px`,
                            animationDelay: `${i * 0.08}s`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-cyan-300/15 bg-cyan-400/5 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-cyan-200">I&apos;m listening...</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300/85">Tell me about the conversation you&apos;re preparing for.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/10 bg-slate-950/40 px-6 py-5 text-center text-xs text-slate-400/80">
        Built for international students navigating a new world.
      </footer>
    </div>
  );
}
