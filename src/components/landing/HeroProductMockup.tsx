import { Mic, Sparkles } from "lucide-react";

/**
 * Right-column product proof: live AI voice session + roleplay + feedback.
 * Static visual; motion via CSS only.
 */
export function HeroProductMockup() {
  return (
    <div className="relative w-full max-w-[440px] lg:max-w-none">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute -inset-10 rounded-[2.5rem] bg-[radial-gradient(ellipse_at_50%_30%,rgba(34,211,238,0.14),transparent_55%)] opacity-90 blur-2xl animate-pulse-slow"
        aria-hidden
      />
      <div className="relative overflow-hidden rounded-[1.75rem] border border-white/[0.12] bg-[linear-gradient(165deg,rgba(15,23,42,0.92)_0%,rgba(8,15,30,0.96)_45%,rgba(6,11,22,0.98)_100%)] p-1 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
        <div className="rounded-[1.6rem] border border-white/[0.06] bg-slate-950/40 p-5 sm:p-6">
          {/* Session header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-cyan-200/90">
                Live voice session
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold tracking-tight text-white">
                  Kabir
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-0.5 text-[11px] font-medium text-cyan-200/95">
                  <Sparkles className="h-3 w-3" aria-hidden />
                  AI practice partner
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Plays the other side · Pushback · Coaching
              </p>
            </div>
            <span className="shrink-0 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
              Live
            </span>
          </div>

          {/* Mini transcript */}
          <div className="mt-5 space-y-3 rounded-xl border border-white/[0.07] bg-slate-950/50 p-4">
            <div className="flex gap-3">
              <span className="mt-0.5 shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                You
              </span>
              <p className="text-sm leading-relaxed text-slate-200/95">
                I need to ask for the raise we talked about. I&apos;ve taken on
                more scope and I want to align on compensation.
              </p>
            </div>
            <div className="flex gap-3 border-t border-white/[0.06] pt-3">
              <span className="mt-0.5 shrink-0 text-[10px] font-medium uppercase tracking-wide text-cyan-400/80">
                Kabir
              </span>
              <p className="text-sm leading-relaxed text-slate-300/90 italic">
                &ldquo;Walk me through what &apos;more scope&apos; means in
                numbers. What changed since last review?&rdquo;
              </p>
            </div>
          </div>

          {/* Waveform + mic */}
          <div className="relative mt-5 flex items-center gap-4 rounded-xl border border-cyan-400/15 bg-gradient-to-br from-cyan-500/[0.07] to-blue-600/[0.04] px-4 py-4">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 shadow-[0_0_32px_rgba(34,211,238,0.2)]">
              <span className="absolute inset-0 rounded-full border border-cyan-400/20 animate-pulse-ring opacity-40" />
              <Mic className="relative z-10 h-6 w-6 text-cyan-200" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-cyan-200/85">
                Your voice · Real-time
              </p>
              <div className="mt-2 flex h-8 items-end gap-1">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <span
                    key={i}
                    className="animate-waveform w-1 rounded-full bg-gradient-to-t from-cyan-400/50 to-cyan-200"
                    style={{
                      height: `${10 + (i % 4) * 4}px`,
                      animationDelay: `${i * 0.07}s`,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Post-session feedback */}
          <div className="mt-4 rounded-xl border border-white/[0.08] bg-slate-900/60 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              After your session
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-200/90">
              <li className="flex gap-2">
                <span className="text-cyan-400/90" aria-hidden>
                  →
                </span>
                <span>Lead with the outcome you want—before the context.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-cyan-400/90" aria-hidden>
                  →
                </span>
                <span>Pause after your ask. Don&apos;t soften it when it gets quiet.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-cyan-400/90" aria-hidden>
                  →
                </span>
                <span>Name one metric that proves the extra scope.</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
