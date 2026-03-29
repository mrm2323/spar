"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { EarlyAccessForm } from "@/app/early-access-form";
import type { BetaWaitlistStatus } from "@/lib/beta-access";

const BG = "#0A0A0F";
const BG_SECTION = "#0F0F17";
const TEXT = "#F1F5F9";
const MUTED = "#94A3B8";
/** Primary accent — sky / cyan */
const ACCENT = "#38BDF8";
/** Secondary glow — violet */
const ACCENT2 = "#A78BFA";

type GenZLandingProps = {
  isSignedIn: boolean;
  isApproved: boolean;
  waitlistStatus: BetaWaitlistStatus | "unknown";
};

function TryKabirHref({ isSignedIn, isApproved }: GenZLandingProps) {
  if (isSignedIn && isApproved) return "/dashboard";
  return "/sign-in";
}

function ScrollReveal({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) setVisible(true);
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function GenZLanding(props: GenZLandingProps) {
  const tryHref = TryKabirHref(props);
  const { isSignedIn, isApproved, waitlistStatus } = props;

  return (
    <div
      className="min-h-screen font-sans text-[15px] leading-relaxed"
      style={{ backgroundColor: BG, color: TEXT }}
    >
      {/* SECTION 1 — HOOK */}
      <header className="relative z-10 mx-auto flex max-w-3xl items-center justify-between px-5 pt-8 sm:px-8">
        <Link
          href="/"
          className="font-mono text-sm tracking-[0.12em]"
          style={{ color: ACCENT }}
        >
          spar
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          {!isSignedIn ? (
            <Link
              href="#waitlist"
              className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/5 sm:px-4"
              style={{ borderColor: `${ACCENT2}99`, color: ACCENT2 }}
            >
              join waitlist
            </Link>
          ) : null}
          <Link
            href={tryHref}
            className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/5 sm:px-4"
            style={{ borderColor: `${ACCENT}99`, color: ACCENT }}
          >
            try kabir
          </Link>
          {isSignedIn ? (
            <UserButton
              appearance={{
                elements: { avatarBox: "h-8 w-8" },
              }}
            />
          ) : null}
        </div>
      </header>

      {isSignedIn && !isApproved ? (
        <div className="mx-auto mt-6 max-w-3xl px-5 sm:px-8">
          <div
            className="rounded-2xl border px-4 py-3 text-sm"
            style={{
              borderColor: `${ACCENT}55`,
              backgroundColor: `${ACCENT}14`,
              color: TEXT,
            }}
          >
            {waitlistStatus === "pending"
              ? "you're on the list — we'll unlock you when we can."
              : waitlistStatus === "rejected"
                ? "this account doesn't have access yet. reach out if that feels wrong."
                : "your account isn't cleared for the beta yet. hang tight or join the waitlist with this email."}
            <div className="mt-2">
              <Link
                href="/beta/pending"
                className="text-xs underline decoration-white/20 underline-offset-2"
                style={{ color: ACCENT }}
              >
                check status
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      <section className="relative mx-auto flex max-w-3xl flex-col items-center px-5 pb-20 pt-16 text-center sm:px-8 sm:pt-20">
        <div className="animate-hero-fade max-w-xl">
          <h1 className="text-[1.85rem] font-bold leading-[1.15] tracking-tight sm:text-5xl sm:leading-[1.1]">
            <span className="block" style={{ color: TEXT }}>
              you know what to say.
            </span>
            <span
              className="accent-glow-pulse mt-2 block"
              style={{ color: ACCENT }}
            >
              you just can&apos;t say it yet.
            </span>
          </h1>
          <p
            className="mx-auto mt-8 max-w-[400px] text-[15px] leading-relaxed sm:text-base"
            style={{ color: MUTED }}
          >
            kabir is the friend you call at 11pm when you&apos;re spiraling about
            tomorrow&apos;s conversation. he listens. he helps you practice. and he
            tells you how your words actually sound.
          </p>
          <div className="mt-10 flex flex-col items-center gap-3">
            <Link
              href={isSignedIn && isApproved ? "/dashboard" : "/sign-in"}
              className="inline-flex min-h-[48px] w-full max-w-xs items-center justify-center rounded-full px-8 py-3 text-sm font-semibold shadow-[0_0_44px_-8px_rgba(56,189,248,0.45)] transition-transform hover:scale-[1.02] active:scale-[0.99] sm:w-auto"
              style={{
                background: `linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT2} 100%)`,
                color: BG,
              }}
            >
              talk to kabir — it&apos;s free
            </Link>
            <p className="text-[11px]" style={{ color: MUTED }}>
              no signup needed for your first session
            </p>
          </div>
        </div>
      </section>

      {/* Waitlist — logged out (high on page + #waitlist for header link) */}
      {!isSignedIn ? (
        <section
          id="waitlist"
          className="scroll-mt-24 border-b border-white/[0.06] pb-16 pt-2"
          style={{ backgroundColor: BG }}
        >
          <div className="mx-auto max-w-md px-5 sm:px-8">
            <p className="text-center text-xs font-medium uppercase tracking-[0.14em]" style={{ color: MUTED }}>
              want early access
            </p>
            <EarlyAccessForm compact hideLabel />
            <p className="mt-4 text-center text-xs" style={{ color: MUTED }}>
              already approved{" "}
              <Link
                href="/sign-in"
                className="underline decoration-white/20 underline-offset-2"
                style={{ color: ACCENT }}
              >
                get started
              </Link>
            </p>
          </div>
        </section>
      ) : null}

      {/* SECTION 2 — MOMENT */}
      <section style={{ backgroundColor: BG_SECTION }} className="py-20 sm:py-24">
        <div className="mx-auto max-w-5xl px-5 sm:px-8">
          <ScrollReveal>
            <div className="grid gap-5 md:grid-cols-3">
              {[
                {
                  time: "11:47 PM",
                  q: 'kabir, i have to tell my roommate their cooking smell is making me sick and i don\'t want to be rude',
                  sub: "kabir helped her lead with appreciation before the ask. the conversation went well.",
                },
                {
                  time: "2:15 PM",
                  q: "i got an offer but they're lowballing me and i feel like i should just be grateful they're sponsoring my visa",
                  sub: "kabir helped him say the number first. he got 15k more.",
                },
                {
                  time: "9:30 AM",
                  q: "my professor keeps interrupting me in class and i don't know if it's because of my accent",
                  sub: "kabir helped her separate the emotion from the conversation. she talked to the professor. it wasn't about the accent.",
                },
              ].map((card) => (
                <div
                  key={card.time}
                  className="rounded-2xl border border-white/[0.08] bg-[#0A0A0F]/80 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                >
                  <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: ACCENT }}>
                    {card.time}
                  </p>
                  <p className="mt-4 text-sm italic leading-relaxed text-[#E2E8F0]">
                    &ldquo;{card.q}&rdquo;
                  </p>
                  <p className="mt-4 text-xs leading-relaxed" style={{ color: MUTED }}>
                    {card.sub}
                  </p>
                </div>
              ))}
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* SECTION 3 — HOW */}
      <section className="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="grid gap-12 sm:grid-cols-3 sm:gap-8">
          {[
            {
              t: "tell kabir what's coming up",
              m: "a roommate talk. a salary ask. a date. whatever you're avoiding.",
            },
            {
              t: "practice it out loud",
              m: "kabir becomes the other person. or he just listens and tells you how it sounds.",
            },
            {
              t: "get kabir's notes",
              m: "not a score. the exact words that worked, the ones that didn't, and the one thing to change.",
            },
          ].map((step, i) => (
            <ScrollReveal key={step.t}>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: MUTED }}>
                  {String(i + 1).padStart(2, "0")}
                </p>
                <p className="mt-3 text-lg font-semibold leading-snug text-[#F8FAFC]">
                  {step.t}
                </p>
                <p className="mt-3 text-sm leading-relaxed" style={{ color: MUTED }}>
                  {step.m}
                </p>
              </div>
            </ScrollReveal>
          ))}
        </div>
        <p className="mx-auto mt-16 max-w-xl text-center text-lg font-medium leading-relaxed text-[#E2E8F0]">
          and he remembers you. every session makes him sharper.
        </p>
      </section>

      {/* SECTION 4 — QUOTES */}
      <section style={{ backgroundColor: BG_SECTION }} className="py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-5 sm:px-8">
          <h2 className="text-center font-mono text-xs uppercase tracking-[0.2em]" style={{ color: ACCENT2 }}>
            what people say after calling kabir
          </h2>
          <div className="mt-10 space-y-5">
            {[
              {
                q: "i literally practiced my salary negotiation with kabir at midnight and got 20k more the next day. what is this app.",
                a: "columbia '26",
              },
              {
                q: "kabir told me i apologize before every request and i've never felt so called out by an AI.",
                a: "nyu grad student",
              },
              {
                q: "i used kabir before telling my roommate i'm moving out. he helped me lead with what i value about the friendship. she cried but it went well.",
                a: "international student, boston",
              },
            ].map((item) => (
              <ScrollReveal key={item.a}>
                <div className="rounded-2xl border border-white/[0.06] bg-[#0A0A0F]/60 px-5 py-5">
                  <p className="text-sm leading-relaxed text-[#E2E8F0]">&ldquo;{item.q}&rdquo;</p>
                  <p className="mt-3 text-xs" style={{ color: MUTED }}>
                    — {item.a}
                  </p>
                </div>
              </ScrollReveal>
            ))}
          </div>
          <p className="mt-8 text-center text-[10px]" style={{ color: MUTED }}>
            *from early beta users
          </p>
        </div>
      </section>

      {/* SECTION 5 — MEMORY */}
      <section className="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="rounded-2xl border border-white/[0.08] bg-[#12121a] px-6 py-12 text-center sm:px-10 sm:py-14">
          <h2 className="text-2xl font-bold leading-tight tracking-tight text-[#F8FAFC] sm:text-3xl">
            kabir never forgets you.
          </h2>
          <p className="mx-auto mt-6 max-w-md text-sm leading-relaxed sm:text-base" style={{ color: MUTED }}>
            he knows you apologize too much. he knows your interview is thursday. he knows you
            improved on directness last week. by your fifth session, he knows you better than your
            career advisor.
          </p>
          <p className="mx-auto mt-4 max-w-lg text-xs leading-relaxed" style={{ color: MUTED }}>
            powered by persistent AI memory — not a chatbot that resets every conversation.
          </p>
          <Link
            href={tryHref}
            className="mt-10 inline-flex min-h-[48px] items-center justify-center rounded-full px-8 py-3 text-sm font-semibold transition-transform hover:scale-[1.02]"
            style={{
              background: `linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT2} 100%)`,
              color: BG,
            }}
          >
            start your first session
          </Link>
        </div>
      </section>

      {/* SECTION 6 — FOOTER */}
      <footer className="border-t border-white/[0.06] px-5 py-12 sm:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-mono text-sm tracking-[0.12em]" style={{ color: ACCENT }}>
            spar
          </p>
          <p className="mt-3 text-sm" style={{ color: MUTED }}>
            built for international students navigating a new world.
          </p>
          <p className="mt-2 text-xs" style={{ color: MUTED }}>
            your conversations are encrypted and never shared.
          </p>
          <div className="mt-6 flex justify-center gap-6 text-xs">
            <a href="mailto:kabir.spar.ai@gmail.com" className="underline decoration-white/15 underline-offset-2" style={{ color: MUTED }}>
              contact
            </a>
            <span style={{ color: MUTED }} className="opacity-40">
              privacy soon
            </span>
          </div>
        </div>
      </footer>

    </div>
  );
}
