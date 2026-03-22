"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function EarlyAccessForm() {
  const router = useRouter();
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
      const formData = new FormData();
      formData.append("email", email);

      // Submit directly so we don't navigate away to Formspree.
      const res = await fetch("https://formspree.io/f/maqpbppn", {
        method: "POST",
        body: formData,
        headers: {
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        throw new Error("Could not submit right now");
      }

      setStatus("success");
      router.push(`/sign-up?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to submit");
    }
  }

  return (
    <div className="mt-10 w-full max-w-lg">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
        Get started
      </p>
      <form
        onSubmit={onSubmit}
        className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-stretch"
      >
        <label htmlFor="early-access-email" className="sr-only">
          Email for early access
        </label>
        <input
          id="early-access-email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Work or personal email"
          className="min-h-[48px] flex-1 rounded-xl border border-white/[0.12] bg-slate-950/60 px-4 py-3 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] placeholder:text-slate-500 outline-none transition-colors focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-400/15"
        />
        <button
          type="submit"
          disabled={status === "submitting"}
          className="min-h-[48px] shrink-0 rounded-xl bg-gradient-to-b from-cyan-300 to-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-[0_0_0_1px_rgba(255,255,255,0.1)_inset,0_10px_28px_rgba(34,211,238,0.25)] transition-all hover:from-cyan-200 hover:to-cyan-400 disabled:opacity-60"
        >
          {status === "submitting"
            ? "Sending…"
            : "Create account"}
        </button>
      </form>
      <p className="mt-3 text-xs text-slate-500">
        We&apos;ll email you a link. No spam—just access when you&apos;re in.
      </p>

      {status === "error" && (
        <p className="mt-3 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

