"use client";

import { useState } from "react";

type EarlyAccessFormProps = {
  /** Tighter top margin when the section heading sits directly above (e.g. landing hero). */
  compact?: boolean;
  /** Hide the built-in "Beta access" line when the parent already has a section title. */
  hideLabel?: boolean;
};

export function EarlyAccessForm({
  compact = false,
  hideLabel = false,
}: EarlyAccessFormProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("submitting");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        throw new Error("couldn't send that. try again?");
      }

      setStatus("success");
      setEmail("");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "something broke. try again?");
    }
  }

  return (
    <div className={`${compact ? "mt-3" : "mt-10"} w-full max-w-lg`}>
      {!hideLabel ? (
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
          Beta access
        </p>
      ) : null}
      <form
        onSubmit={onSubmit}
        className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-stretch"
      >
        <label htmlFor="early-access-email" className="sr-only">
          Email for waitlist
        </label>
        <input
          id="early-access-email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === "success"}
          placeholder="Work or personal email"
          className="min-h-[48px] flex-1 rounded-xl border border-white/[0.12] bg-slate-950/60 px-4 py-3 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] placeholder:text-slate-500 outline-none transition-colors focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-400/15 disabled:opacity-70"
        />
        <button
          type="submit"
          disabled={status === "submitting" || status === "success"}
          className="min-h-[48px] shrink-0 rounded-xl bg-gradient-to-b from-cyan-300 to-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-[0_0_0_1px_rgba(255,255,255,0.1)_inset,0_10px_28px_rgba(34,211,238,0.25)] transition-all hover:from-cyan-200 hover:to-cyan-400 disabled:opacity-60"
        >
          {status === "submitting"
            ? "Sending…"
            : status === "success"
              ? "You’re in the queue"
              : "Join waitlist"}
        </button>
      </form>
      <p className="mt-3 text-xs text-slate-500">
        {status === "success"
          ? "Thanks — we’ll email you when your spot opens. If you already have an account, we’ll unlock access when you’re approved."
          : "We’ll email you when we’re ready. No spam."}
      </p>

      {status === "error" && (
        <p className="mt-3 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
